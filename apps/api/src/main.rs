mod ai;
mod auth;
mod error;
mod model;
mod routes;
mod schedule;
mod stats;
mod store;
mod validation;

use crate::error::ApiError;
use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::config::{Credentials, Region};
use axum::{
    extract::{DefaultBodyLimit, Request},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};

#[derive(Clone)]
pub struct AppState {
    pub store: store::Store,
    pub http: reqwest::Client,
    pub provider_key: Option<String>,
    pub production: bool,
    pub dev_user: String,
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let production = std::env::var_os("AWS_LAMBDA_RUNTIME_API").is_some()
        || std::env::var_os("AWS_LAMBDA_FUNCTION_NAME").is_some();
    if !production {
        if let Some(root) = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(|path| path.parent())
        {
            let _ = dotenvy::from_path(root.join(".env"));
        }
    }
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .without_time()
        .try_init();
    let table = if production {
        std::env::var("TABLE_NAME").map_err(|_| "TABLE_NAME is required in Lambda")?
    } else {
        std::env::var("TABLE_NAME").unwrap_or_else(|_| "beehappy-local".into())
    };
    if table.trim().is_empty() {
        return Err("TABLE_NAME must not be empty".into());
    }
    let shared = if production {
        aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new("us-east-2"))
            .load()
            .await
    } else {
        let endpoint =
            std::env::var("DYNAMODB_ENDPOINT").unwrap_or_else(|_| "http://127.0.0.1:4586".into());
        let url = reqwest::Url::parse(&endpoint).map_err(|_| "Invalid local DYNAMODB_ENDPOINT")?;
        if !matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
        ) || url.scheme() != "http"
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Local DYNAMODB_ENDPOINT must be loopback HTTP".into());
        }
        aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new("us-east-2"))
            .credentials_provider(Credentials::new("test", "test", None, None, "local-only"))
            .endpoint_url(endpoint)
            .load()
            .await
    };
    let dev_user = if production {
        String::new()
    } else {
        std::env::var("DEV_USER").unwrap_or_else(|_| "local".into())
    };
    if !production && validation::identifier(&dev_user).is_err() {
        return Err("DEV_USER must be a nonempty identifier".into());
    }
    let state = AppState {
        store: store::Store::new(aws_sdk_dynamodb::Client::new(&shared), table),
        http: reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(24))
            .build()?,
        provider_key: std::env::var("OPENROUTER_API_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty()),
        production,
        dev_user,
    };
    let mut app = Router::new()
        .route("/api/health", get(routes::health))
        .route("/api/words", get(routes::words).post(routes::create))
        .route(
            "/api/words/{id}",
            get(routes::detail)
                .put(routes::update)
                .delete(routes::remove),
        )
        .route("/api/words/{id}/reviews", post(routes::grade))
        .route("/api/review", get(routes::review))
        .route("/api/stats", get(stats::stats))
        .route("/api/ai/meanings", post(ai::meanings))
        .route("/api/ai/sentences", post(ai::sentences))
        .fallback(|| async { ApiError(StatusCode::NOT_FOUND, "Endpoint not found.".into()) })
        .layer(DefaultBodyLimit::max(512 * 1024))
        .layer(middleware::from_fn(json_errors))
        .with_state(state);
    if !production {
        app = app.layer(middleware::from_fn(auth::local_boundary));
    }
    if production {
        lambda_http::run(app).await?;
    } else {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:9860").await?;
        tracing::info!("Local API listening on http://127.0.0.1:9860");
        axum::serve(listener, app).await?;
    }
    Ok(())
}
async fn json_errors(request: Request, next: Next) -> Response {
    let response = next.run(request).await;
    if response.status().is_client_error() || response.status().is_server_error() {
        let json = response
            .headers()
            .get(header::CONTENT_TYPE)
            .is_some_and(|value| value.as_bytes().starts_with(b"application/json"));
        if !json {
            return ApiError(
                response.status(),
                response
                    .status()
                    .canonical_reason()
                    .unwrap_or("Request failed")
                    .into(),
            )
            .into_response();
        }
    }
    response
}
