use crate::{
    error::{ApiError, ApiResult},
    AppState,
};
use axum::{
    extract::{FromRequestParts, Request},
    http::{header, request::Parts, HeaderMap},
    middleware::Next,
    response::Response,
};
use lambda_http::RequestExt;

pub struct User(pub String);
impl FromRequestParts<AppState> for User {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> ApiResult<Self> {
        if state.production {
            let subject = parts
                .request_context_ref()
                .and_then(|context| context.authorizer())
                .and_then(|authorizer| authorizer.jwt.as_ref())
                .and_then(|jwt| jwt.claims.get("sub"))
                .cloned()
                .ok_or_else(ApiError::unauthorized)?;
            if crate::validation::identifier(&subject).is_err() {
                return Err(ApiError::unauthorized());
            }
            return Ok(User(subject));
        }
        Ok(User(state.dev_user.clone()))
    }
}
fn loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}
fn validate(headers: &HeaderMap) -> ApiResult<()> {
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<axum::http::uri::Authority>().ok());
    if !host.is_some_and(|host| loopback(host.host())) {
        return Err(ApiError::bad("Only loopback Host headers are accepted."));
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        let url = origin
            .to_str()
            .ok()
            .and_then(|value| reqwest::Url::parse(value).ok());
        if !url.is_some_and(|url| {
            matches!(url.scheme(), "http" | "https")
                && url.host_str().is_some_and(loopback)
                && url.username().is_empty()
                && url.password().is_none()
                && url.path() == "/"
                && url.query().is_none()
                && url.fragment().is_none()
        }) {
            return Err(ApiError::bad("Only loopback browser origins are accepted."));
        }
    }
    Ok(())
}
pub async fn local_boundary(request: Request, next: Next) -> ApiResult<Response> {
    validate(request.headers())?;
    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn loopback_boundary_rejects_remote_and_null_origins() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "127.0.0.1:9860".parse().unwrap());
        headers.insert(header::ORIGIN, "http://localhost:9861".parse().unwrap());
        assert!(validate(&headers).is_ok());
        for origin in ["null", "https://evil.test", "http://localhost.evil.test"] {
            headers.insert(header::ORIGIN, origin.parse().unwrap());
            assert!(validate(&headers).is_err());
        }
        headers.remove(header::ORIGIN);
        headers.insert(header::HOST, "evil.test".parse().unwrap());
        assert!(validate(&headers).is_err());
    }
}
