use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

pub type ApiResult<T> = Result<T, ApiError>;
#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);
impl ApiError {
    pub fn bad(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self(StatusCode::CONFLICT, message.into())
    }
    pub fn missing() -> Self {
        Self(StatusCode::NOT_FOUND, "Word not found.".into())
    }
    pub fn unauthorized() -> Self {
        Self(StatusCode::UNAUTHORIZED, "Authentication required.".into())
    }
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self(StatusCode::SERVICE_UNAVAILABLE, message.into())
    }
    pub fn provider(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_GATEWAY, message.into())
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({"error": self.1}))).into_response()
    }
}
pub fn storage(error: impl std::fmt::Debug) -> ApiError {
    tracing::error!(error = ?error, "DynamoDB operation failed");
    ApiError::unavailable("Vocabulary storage is temporarily unavailable. Please retry.")
}
