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
    pub quality: Option<f64>,
    pub trim_start: Option<f64>,
    pub trim_end: Option<f64>,
    pub crop_w: Option<u32>,
    pub crop_h: Option<u32>,
    pub crop_x: Option<u32>,
    pub crop_y: Option<u32>,
    pub crop_ratio: Option<String>,
    pub speed_video: Option<f64>,
    pub speed_audio: Option<f64>,
    pub rotate: Option<u32>,
    pub flip: Option<String>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
    /// Audio normalization: "loudnorm" (EBU R128) | "dynaudnorm" (peak)
    #[serde(default)]
    pub audio_normalize: Option<String>,
    /// Audio fade-in duration (seconds)
    #[serde(default)]
    pub fade_in: Option<f64>,
    /// Audio fade-out duration (seconds)
    #[serde(default)]
    pub fade_out: Option<f64>,
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
            quality: None,
            trim_start: None,
            trim_end: None,
            crop_w: None,
            crop_h: None,
            crop_x: None,
            crop_y: None,
            crop_ratio: None,
            speed_video: None,
            speed_audio: None,
            rotate: None,
            flip: None,
            sample_rate: None,
            channels: None,
            audio_normalize: None,
            fade_in: None,
            fade_out: None,
        }
    }
}

impl ConversionParams {
    /// Convenience for serde `default =` attributes on structs that embed
    /// a conversion preset (e.g. watch folders).
    pub fn default_value() -> Self {
        Self::default()
    }
}
