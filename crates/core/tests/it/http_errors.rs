//! Todo helper de `catalog::http::Http` da error con un status que no sea 2xx, aunque el cuerpo sea JSON
//! (2026-11-23). Antes `post_multipart_auth` leía el 403 de CSRF de la web (`{"message":…}`) como una respuesta
//! vacía y el desktop fallaba con "createtorrent sin id" sin decir por qué. Servidor HTTP local, sin red.

use std::time::Duration;

use serde_json::Value;
use streamonte_core::catalog::http::{FetchError, Http};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const T: Duration = Duration::from_secs(5);

/// Responde siempre `403` con un JSON (como SvelteKit al rechazar un POST por CSRF).
async fn serve_403() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut buf = vec![0u8; 16 * 1024];
                let _ = sock.read(&mut buf).await;
                let body = r#"{"message":"Cross-site POST form submissions are forbidden"}"#;
                let resp = format!(
                    "HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(resp.as_bytes()).await;
            });
        }
    });
    format!("http://{addr}/x")
}

#[tokio::test]
async fn status_no_2xx_es_error_en_todos_los_helpers() {
    let url = serve_403().await;
    let http = Http::new(T);
    let auth = ("Cookie", "code=000");

    assert_eq!(
        http.get_json::<Value>(&url, T).await,
        Err(FetchError::Status(403)),
        "get_json"
    );
    assert_eq!(
        http.get_json_auth::<Value>(&url, auth, T).await,
        Err(FetchError::Status(403)),
        "get_json_auth"
    );
    assert_eq!(
        http.get_json_bearer::<Value>(&url, "k", T).await,
        Err(FetchError::Status(403)),
        "get_json_bearer"
    );
    assert_eq!(
        http.post_multipart_auth::<Value>(&url, auth, &[("a", "b".into())], T)
            .await,
        Err(FetchError::Status(403)),
        "post_multipart_auth"
    );
    assert_eq!(
        http.get_text(&url, T).await,
        Err(FetchError::Status(403)),
        "get_text"
    );
    assert_eq!(
        http.head_bytes(&url, 1024, T).await,
        Err(FetchError::Status(403)),
        "head_bytes"
    );
    assert_eq!(
        http.get_large(&url, 1024, T).await,
        Err(FetchError::Status(403)),
        "get_large"
    );
}
