use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionParams {
    pub input_path: PathBuf,
    pub output_dir: PathBuf,
    pub output_format: String,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub video_bitrate: Option<String>,
    pub audio_bitrate: Option<String>,
    pub resolution: Option<(u32, u32)>,
    pub framerate: Option<f64>,
    pub crf: Option<u8>,
    pub preset: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchConversionParams {
    pub input_dir: PathBuf,
    pub output_dir: PathBuf,
    pub input_extension: String,
    pub output_format: String,
    #[serde(default)]
    pub skip: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedFile {
    pub path: String,
    pub name: String,
    pub size: u64,
}

impl Default for ConversionParams {
    fn default() -> Self {
        Self {
            input_path: PathBuf::new(),
            output_dir: PathBuf::new(),
            output_format: String::new(),
            video_codec: None,
            audio_codec: None,
            video_bitrate: None,
            audio_bitrate: None,
            resolution: None,
            framerate: None,
            crf: None,
            preset: None,
        }
    }
}
