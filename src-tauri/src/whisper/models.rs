use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A whisper.cpp ggml model file offered for download.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModel {
    /// Stable identifier, e.g. `"base"` or `"base-en"`.
    pub id: String,
    /// Human label for the picker UI.
    pub label: String,
    /// File name written into the models dir, e.g. `"ggml-base.bin"`.
    pub file_name: String,
    /// Direct download URL on Hugging Face.
    pub url: String,
    /// Uncompressed size in bytes (used for the picker + free-space checks).
    pub size_bytes: u64,
    /// `"multilingual"` or `"english-only"`. English-only models are slightly
    /// more accurate on English audio but can't transcribe other languages.
    pub language_class: String,
    /// Rough accuracy tier for badges: `"fast"`, `"balanced"`, `"accurate"`, `"best"`.
    pub tier: String,
    /// One-line description shown under the label.
    pub description: String,
    /// `true` if the model file is currently on disk.
    pub installed: bool,
}

/// Catalog of models offered for download. Ordered roughly fast → best.
///
/// URLs follow the convention used by the official ggml-org/whisper.cpp
/// Hugging Face repo: `huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<id>.bin`.
fn catalog() -> Vec<WhisperModel> {
    let base = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
    let entry = |id: &str, label: &str, file: &str, size_mb: u64, class: &str, tier: &str, desc: &str| WhisperModel {
        id: id.to_string(),
        label: label.to_string(),
        file_name: file.to_string(),
        url: format!("{}/{}", base, file),
        size_bytes: size_mb * 1024 * 1024,
        language_class: class.to_string(),
        tier: tier.to_string(),
        description: desc.to_string(),
        installed: false,
    };

    vec![
        entry("tiny", "tiny", "ggml-tiny.bin", 75, "multilingual", "fast",
            "fastest, lowest accuracy — quick drafts and very long files"),
        entry("tiny-en", "tiny.en", "ggml-tiny.en.bin", 75, "english-only", "fast",
            "fastest, English-only"),
        entry("base", "base", "ggml-base.bin", 142, "multilingual", "balanced",
            "good balance of speed and accuracy — recommended default"),
        entry("base-en", "base.en", "ggml-base.en.bin", 142, "english-only", "balanced",
            "good balance, English-only"),
        entry("small", "small", "ggml-small.bin", 466, "multilingual", "accurate",
            "high accuracy, slower — great for captions"),
        entry("small-en", "small.en", "ggml-small.en.bin", 466, "english-only", "accurate",
            "high accuracy, English-only"),
        entry("medium", "medium", "ggml-medium.bin", 1500, "multilingual", "accurate",
            "very high accuracy, slow — heavy use"),
        entry("medium-en", "medium.en", "ggml-medium.en.bin", 1500, "english-only", "accurate",
            "very high accuracy, English-only"),
        entry("large-v3", "large-v3", "ggml-large-v3.bin", 3000, "multilingual", "best",
            "best possible accuracy — slowest, 3 GB download"),
    ]
}

/// Path a given model file would occupy on disk (whether or not it's there).
pub fn model_path(id: &str) -> Option<PathBuf> {
    catalog()
        .iter()
        .find(|m| m.id == id)
        .map(|m| crate::whisper::models_dir().join(&m.file_name))
}

/// `true` if the model file for `id` currently exists in the models dir.
pub fn is_model_installed(id: &str) -> bool {
    model_path(id)
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Catalog annotated with each model's current install state.
pub fn list_models() -> Vec<WhisperModel> {
    catalog()
        .into_iter()
        .map(|mut m| {
            m.installed = is_model_installed(&m.id);
            m
        })
        .collect()
}

/// Look up a single model entry by id (install flag populated).
pub fn find_model(id: &str) -> Option<WhisperModel> {
    list_models().into_iter().find(|m| m.id == id)
}

/// Resolve the on-disk path of an installed model, or `Err` with a helpful
/// message if it isn't present. Used by `transcribe_audio` to fail fast
/// before invoking whisper-cli.
pub fn require_installed_model(id: &str) -> Result<PathBuf, String> {
    match model_path(id) {
        Some(path) if path.exists() => Ok(path),
        Some(_) => Err(format!(
            "model '{}' is not installed. open the model manager to download it.",
            id
        )),
        None => Err(format!("unknown model id: {}", id)),
    }
}
