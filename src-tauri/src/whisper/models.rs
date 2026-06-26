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
    /// `true` if this is a quantized (Q5/Q8) variant of a full-precision model.
    pub quantized: bool,
    /// Family group used to cluster models in the picker dropdown, e.g. `"tiny"`, `"base"`, `"large-v3-turbo"`.
    pub category: String,
    /// One-line description shown under the label.
    pub description: String,
    /// `true` if the model file is currently on disk.
    pub installed: bool,
}

/// Catalog of models offered for download. Ordered roughly fast → best,
/// with quantized variants listed directly after their full-precision parent.
///
/// Most URLs follow the convention used by the official ggml-org/whisper.cpp
/// Hugging Face repo: `huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<id>.bin`.
/// Distil-whisper models live in a separate repo and use a custom URL.
fn catalog() -> Vec<WhisperModel> {
    let base = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";
    let entry = |id: &str, label: &str, file: &str, size_mb: u64, class: &str, tier: &str, quantized: bool, category: &str, desc: &str| WhisperModel {
        id: id.to_string(),
        label: label.to_string(),
        file_name: file.to_string(),
        url: format!("{}/{}", base, file),
        size_bytes: size_mb * 1024 * 1024,
        language_class: class.to_string(),
        tier: tier.to_string(),
        quantized,
        category: category.to_string(),
        description: desc.to_string(),
        installed: false,
    };
    // Distil models use a different HF repo + file naming convention.
    let distil = |id: &str, label: &str, file: &str, size_mb: u64, class: &str, tier: &str, category: &str, desc: &str| WhisperModel {
        id: id.to_string(),
        label: label.to_string(),
        file_name: file.to_string(),
        url: format!("https://huggingface.co/distil-whisper/{}-ggml/resolve/main/{}", id, file),
        size_bytes: size_mb * 1024 * 1024,
        language_class: class.to_string(),
        tier: tier.to_string(),
        quantized: false,
        category: category.to_string(),
        description: desc.to_string(),
        installed: false,
    };

    vec![
        // --- tiny ---
        entry("tiny", "tiny", "ggml-tiny.bin", 75, "multilingual", "fast", false, "tiny",
            "fastest, lowest accuracy — quick drafts and very long files"),
        entry("tiny-q5_1", "tiny Q5", "ggml-tiny-q5_1.bin", 32, "multilingual", "fast", true, "tiny",
            "tiny quantized to Q5 — 32 MB, ultra-light"),
        entry("tiny-en", "tiny.en", "ggml-tiny.en.bin", 75, "english-only", "fast", false, "tiny",
            "fastest, English-only"),
        entry("tiny-en-q5_1", "tiny.en Q5", "ggml-tiny.en-q5_1.bin", 32, "english-only", "fast", true, "tiny",
            "tiny quantized to Q5, English-only"),

        // --- base ---
        entry("base", "base", "ggml-base.bin", 142, "multilingual", "balanced", false, "base",
            "good balance of speed and accuracy — recommended default"),
        entry("base-q5_1", "base Q5", "ggml-base-q5_1.bin", 60, "multilingual", "balanced", true, "base",
            "base quantized to Q5 — 60 MB, fast with good accuracy"),
        entry("base-en", "base.en", "ggml-base.en.bin", 142, "english-only", "balanced", false, "base",
            "good balance, English-only"),
        entry("base-en-q5_1", "base.en Q5", "ggml-base.en-q5_1.bin", 60, "english-only", "balanced", true, "base",
            "base quantized to Q5, English-only"),

        // --- small ---
        entry("small", "small", "ggml-small.bin", 466, "multilingual", "accurate", false, "small",
            "high accuracy, slower — great for captions"),
        entry("small-q5_1", "small Q5", "ggml-small-q5_1.bin", 190, "multilingual", "accurate", true, "small",
            "small quantized to Q5 — 190 MB, great portable option"),
        entry("small-en", "small.en", "ggml-small.en.bin", 466, "english-only", "accurate", false, "small",
            "high accuracy, English-only"),
        entry("small-en-q5_1", "small.en Q5", "ggml-small.en-q5_1.bin", 190, "english-only", "accurate", true, "small",
            "small quantized to Q5, English-only"),

        // --- medium ---
        entry("medium", "medium", "ggml-medium.bin", 1500, "multilingual", "accurate", false, "medium",
            "very high accuracy, slow — heavy use"),
        entry("medium-q5_0", "medium Q5", "ggml-medium-q5_0.bin", 539, "multilingual", "accurate", true, "medium",
            "medium quantized to Q5 — 539 MB, good for most use"),
        entry("medium-en", "medium.en", "ggml-medium.en.bin", 1500, "english-only", "accurate", false, "medium",
            "very high accuracy, English-only"),
        entry("medium-en-q5_0", "medium.en Q5", "ggml-medium.en-q5_0.bin", 539, "english-only", "accurate", true, "medium",
            "medium quantized to Q5, English-only"),

        // --- large-v3 ---
        entry("large-v3", "large-v3", "ggml-large-v3.bin", 3000, "multilingual", "best", false, "large-v3",
            "best possible accuracy — slowest, 3 GB download"),
        entry("large-v3-q5_0", "large-v3 Q5", "ggml-large-v3-q5_0.bin", 1080, "multilingual", "best", true, "large-v3",
            "large-v3 quantized to Q5 — 1.1 GB, slightly reduced accuracy"),

        // --- large-v3-turbo ---
        entry("large-v3-turbo", "large-v3-turbo", "ggml-large-v3-turbo.bin", 1620, "multilingual", "best", false, "large-v3-turbo",
            "near large-v3 accuracy, 3× faster — best speed/accuracy tradeoff"),
        entry("large-v3-turbo-q5_0", "large-v3-turbo Q5", "ggml-large-v3-turbo-q5_0.bin", 574, "multilingual", "best", true, "large-v3-turbo",
            "turbo quantized to Q5 — 574 MB, near-turbo accuracy"),
        entry("large-v3-turbo-q8_0", "large-v3-turbo Q8", "ggml-large-v3-turbo-q8_0.bin", 874, "multilingual", "best", true, "large-v3-turbo",
            "turbo quantized to Q8 — 874 MB, closer to full turbo"),

        // --- distil-whisper ---
        distil("distil-large-v3", "distil-large-v3", "ggml-distil-large-v3.bin", 1520, "multilingual", "best", "distil-large-v3",
            "distilled from large-v3 — 6× faster, near-large accuracy"),
        distil("distil-large-v3.5", "distil-large-v3.5", "ggml-distil-large-v3.5.bin", 1520, "multilingual", "best", "distil-large-v3.5",
            "latest distilled model — best distil-whisper quality"),
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
