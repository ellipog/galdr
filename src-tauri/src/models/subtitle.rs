use serde::{Deserialize, Serialize};

/// Styling applied to burned-in subtitles. All fields optional so a caller
/// can set only the ones they care about; the FFmpeg `subtitles` filter
/// merges whatever's present with its own defaults via `force_style`.
///
/// Colours use the ASS `&HAABBGGRR` convention (8 hex digits, blue-green-red
/// byte order with an alpha byte) — this is what FFmpeg's `force_style`
/// expects, not the more familiar `#RRGGBB`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyle {
    /// Font family name, e.g. "Arial". Must be a font libass can resolve on
    /// the system; missing fonts fall back to a default.
    pub font_name: Option<String>,
    /// Font size in points.
    pub font_size: Option<u32>,
    /// Body text colour as an ASS hex string, e.g. "&H00FFFFFF" (opaque white).
    pub primary_color: Option<String>,
    /// Outline / stroke colour, e.g. "&H00000000" (opaque black).
    pub outline_color: Option<String>,
    /// Outline thickness in pixels.
    pub outline_width: Option<f32>,
    /// Vertical margin in pixels (distance from the bottom edge).
    pub margin_v: Option<u32>,
    /// ASS numpad alignment (1–9). 2 = bottom-centre (the usual default).
    pub alignment: Option<u32>,
    /// Bold weight (0 = normal, 1 = bold, -1 = keep default).
    pub bold: Option<i32>,
    /// Background box opacity 0–255 (0 = transparent, the libass default).
    pub back_color: Option<String>,
}

impl SubtitleStyle {
    /// Render the populated fields as a `force_style=` value string (the part
    /// inside the quotes), e.g. `FontSize=24,PrimaryColour=&H00FFFFFF,...`.
    /// Empty string when nothing is set.
    pub fn to_force_style(&self) -> String {
        let mut parts: Vec<String> = Vec::new();
        if let Some(name) = &self.font_name {
            if !name.is_empty() {
                parts.push(format!("Fontname={}", name));
            }
        }
        if let Some(size) = self.font_size {
            parts.push(format!("FontSize={}", size));
        }
        if let Some(c) = &self.primary_color {
            parts.push(format!("PrimaryColour={}", c));
        }
        if let Some(c) = &self.outline_color {
            parts.push(format!("OutlineColour={}", c));
        }
        if let Some(c) = &self.back_color {
            parts.push(format!("BackColour={}", c));
        }
        if let Some(w) = self.outline_width {
            parts.push(format!("Outline={}", w));
        }
        if let Some(m) = self.margin_v {
            parts.push(format!("MarginV={}", m));
        }
        if let Some(a) = self.alignment {
            parts.push(format!("Alignment={}", a));
        }
        if let Some(b) = self.bold {
            parts.push(format!("Bold={}", b));
        }
        parts.join(",")
    }

    /// `true` when no styling field is set — lets the builder skip emitting
    /// `force_style` entirely so FFmpeg uses its own subtitle defaults.
    pub fn is_empty(&self) -> bool {
        self.font_name.as_deref().unwrap_or("").is_empty()
            && self.font_size.is_none()
            && self.primary_color.is_none()
            && self.outline_color.is_none()
            && self.back_color.is_none()
            && self.outline_width.is_none()
            && self.margin_v.is_none()
            && self.alignment.is_none()
            && self.bold.is_none()
    }
}

/// Sensible burn-in defaults: white text, black outline, bottom-centre,
/// sized for typical 1080p viewing. The UI overrides per-session.
impl SubtitleStyle {
    pub fn defaults() -> Self {
        Self {
            font_name: None,
            font_size: Some(24),
            primary_color: Some("&H00FFFFFF".to_string()), // opaque white
            outline_color: Some("&H00000000".to_string()), // opaque black
            outline_width: Some(2.0),
            margin_v: Some(40),
            alignment: Some(2), // bottom-centre
            bold: None,
            back_color: None,
        }
    }
}
