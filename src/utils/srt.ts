import type { Cue } from "../types";

/**
 * SRT / WebVTT parsing, serialization, and editing helpers.
 *
 * All operations are pure TypeScript — no backend calls — so the editor
 * stays fast and fully offline. Timestamps are stored as seconds (float)
 * everywhere internally; conversion to/from the `HH:MM:SS,mmm` (SRT) or
 * `HH:MM:SS.mmm` (VTT) display formats happens at the parse/serialize
 * boundary.
 */

// ── Timestamp formatting ──

/** Seconds → `HH:MM:SS,mmm` (SRT convention, comma decimal separator). */
export function formatSrtTime(seconds: number): string {
  const { h, m, s, ms } = splitTime(seconds);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`;
}

/** Seconds → `HH:MM:SS.mmm` (VTT convention, dot decimal separator). */
export function formatVttTime(seconds: number): string {
  const { h, m, s, ms } = splitTime(seconds);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
}

function splitTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const totalSec = Math.floor(safe);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { h, m, s, ms };
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, "0");
}

// ── Parsing ──

/** Parse a `HH:MM:SS,mmm` or `HH:MM:SS.mmm` timestamp into seconds. */
export function parseTime(raw: string): number {
  const text = raw.trim().replace(",", ".");
  // Accept H:MM:SS.mmm, MM:SS.mmm, or SS.mmm
  const parts = text.split(":");
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return Number(m) * 60 + Number(s);
  }
  return Number(parts[0]) || 0;
}

const CUE_ARROW = /-->/;

/** Parse SRT text into cues. Tolerant of missing indices and blank lines. */
export function parseSrt(text: string): Cue[] {
  return parseBlocks(text, false);
}

/** Parse WebVTT text into cues, skipping the `WEBVTT` header and NOTE blocks. */
export function parseVtt(text: string): Cue[] {
  return parseBlocks(text, true);
}

function parseBlocks(text: string, isVtt: boolean): Cue[] {
  // Normalize line endings and split into cue blocks separated by blank lines.
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n[ \t]*\n/);

  const cues: Cue[] = [];
  let index = 1;

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    // Skip VTT header / NOTE / STYLE / REGION blocks.
    if (isVtt) {
      const first = lines[0].trim().toUpperCase();
      if (first === "WEBVTT" || first.startsWith("NOTE") || first.startsWith("STYLE") || first.startsWith("REGION")) {
        continue;
      }
    }

    // The timing line is the first line containing `-->`. An optional index
    // line may precede it.
    let timingIdx = lines.findIndex((l) => CUE_ARROW.test(l));
    if (timingIdx === -1) continue;

    const timingLine = lines[timingIdx];
    const { start, end } = parseTimingLine(timingLine);
    if (!isFinite(start) || !isFinite(end)) continue;

    const textLines = lines.slice(timingIdx + 1);
    const cueText = textLines.join("\n").trim();

    cues.push({
      index: index++,
      start,
      end,
      text: cueText,
    });
  }

  return cues;
}

/** Pull start/end out of a `00:00:01.000 --> 00:00:03.000 ...` line. */
function parseTimingLine(line: string): { start: number; end: number } {
  const match = line.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
  if (!match) return { start: NaN, end: NaN };
  return { start: parseTime(match[1]), end: parseTime(match[2]) };
}

// ── Serialization ──

/** Cues → SRT text. */
export function serializeSrt(cues: Cue[]): string {
  return cues.map((c, i) => {
    const idx = i + 1;
    return `${idx}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}`;
  }).join("\n\n") + "\n";
}

/** Cues → WebVTT text (with `WEBVTT` header). */
export function serializeVtt(cues: Cue[]): string {
  const body = cues.map((c) =>
    `${formatVttTime(c.start)} --> ${formatVttTime(c.end)}\n${c.text}`,
  ).join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

// ── Conversions ──

export function srtToVtt(srt: string): string {
  return serializeVtt(parseSrt(srt));
}

export function vttToSrt(vtt: string): string {
  return serializeSrt(parseVtt(vtt));
}

// ── Edits ──

/**
 * Shift every cue's start and end by `deltaSeconds`. Negative values shift
 * earlier — the classic fix for a transcript that's uniformly out of sync.
 * Clamps to zero so cues never start before t=0.
 */
export function shiftCues(cues: Cue[], deltaSeconds: number): Cue[] {
  return cues.map((c) => ({
    ...c,
    start: Math.max(0, c.start + deltaSeconds),
    end: Math.max(0, c.end + deltaSeconds),
  }));
}

/** Merge two adjacent cues into one (text concatenated with a newline). */
export function mergeCues(cues: Cue[], aIndex: number, bIndex: number): Cue[] {
  const a = cues[aIndex];
  const b = cues[bIndex];
  if (!a || !b) return cues;
  const merged: Cue = {
    index: a.index,
    start: a.start,
    end: b.end,
    text: `${a.text}\n${b.text}`,
  };
  return [
    ...cues.slice(0, aIndex),
    merged,
    ...cues.slice(bIndex + 1),
  ].map((c, i) => ({ ...c, index: i + 1 }));
}

/**
 * Split a cue into two at the given offset (seconds from the cue start).
 * The text is assigned entirely to the first half; the editor can refine.
 */
export function splitCue(cues: Cue[], cueIndex: number, offsetSeconds: number): Cue[] {
  const cue = cues[cueIndex];
  if (!cue) return cues;
  const splitAt = cue.start + offsetSeconds;
  if (splitAt <= cue.start || splitAt >= cue.end) return cues;
  const first: Cue = { index: cue.index, start: cue.start, end: splitAt, text: cue.text };
  const second: Cue = { index: cue.index + 1, start: splitAt, end: cue.end, text: "" };
  return [
    ...cues.slice(0, cueIndex),
    first,
    second,
    ...cues.slice(cueIndex + 1),
  ].map((c, i) => ({ ...c, index: i + 1 }));
}

/** Delete a cue and renumber the rest. */
export function deleteCue(cues: Cue[], cueIndex: number): Cue[] {
  return cues
    .filter((_, i) => i !== cueIndex)
    .map((c, i) => ({ ...c, index: i + 1 }));
}

/** Find/replace across all cue text. Returns new cues + match count. */
export function replaceInCues(
  cues: Cue[],
  search: string,
  replacement: string,
): { cues: Cue[]; matches: number } {
  let matches = 0;
  const next = cues.map((c) => {
    if (!search || !c.text.includes(search)) return c;
    const count = countOccurrences(c.text, search);
    matches += count;
    return { ...c, text: c.text.split(search).join(replacement) };
  });
  return { cues: next, matches };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while ((from = haystack.indexOf(needle, from)) !== -1) {
    count++;
    from += needle.length;
  }
  return count;
}
