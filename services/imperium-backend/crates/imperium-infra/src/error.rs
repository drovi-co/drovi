use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    Configuration,
    Internal,
    Dependency,
    Unavailable,
    Validation,
    Unauthorized,
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
    pub status: StatusCode,
}

#[derive(Debug, Serialize)]
struct ApiErrorBody {
    code: AppErrorCode,
    message: String,
}

impl AppError {
    pub fn configuration(message: impl Into<String>) -> Self {
        Self {
            code: AppErrorCode::Configuration,
            message: message.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn dependency(message: impl Into<String>) -> Self {
        Self {
            code: AppErrorCode::Dependency,
            message: message.into(),
            status: StatusCode::BAD_GATEWAY,
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: AppErrorCode::Unavailable,
            message: message.into(),
            status: StatusCode::SERVICE_UNAVAILABLE,
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: AppErrorCode::Internal,
            message: message.into(),
            status: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            code: AppErrorCode::Validation,
            message: message.into(),
            status: StatusCode::BAD_REQUEST,
        }
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            code: AppErrorCode::Unauthorized,
            message: message.into(),
            status: StatusCode::UNAUTHORIZED,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let status = self.status;
        let body = ApiErrorBody {
            code: self.code,
            message: self.message,
        };
        (status, Json(body)).into_response()
    }
}
