//! The resume file (`<name>.swiftdl`) that sits next to the `.part` file.
//! It records which byte ranges are still missing, so a crash, Ctrl+C or
//! dropped network never costs more than the last second of progress.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedState {
    pub url: String,
    pub size: u64,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    /// Remaining `[pos, end)` ranges. Everything outside them is on disk.
    pub segments: Vec<(u64, u64)>,
}

impl SavedState {
    pub fn load(path: &Path) -> Option<Self> {
        let text = std::fs::read_to_string(path).ok()?;
        serde_json::from_str(&text).ok()
    }

    /// Writes to a temp file first, then renames, so the state file is never
    /// left half-written.
    pub fn save(&self, path: &Path) -> Result<()> {
        let tmp = path.with_extension("swiftdl.tmp");
        std::fs::write(&tmp, serde_json::to_vec(self)?)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn valid_ranges(&self) -> bool {
        let mut ranges = self.segments.clone(); ranges.sort_unstable();
        let mut end = 0;
        for (start, next) in ranges {
            if start < end || start >= next || next > self.size { return false; }
            end = next;
        }
        true
    }

    /// True when this state describes the same remote file version.
    pub fn matches(&self, url: &str, size: u64, etag: &Option<String>, last_modified: &Option<String>) -> bool {
        self.url == url
            && self.size == size
            && (etag.is_some() || last_modified.is_some())
            && &self.etag == etag
            && &self.last_modified == last_modified
            && self.valid_ranges()
    }
}

#[cfg(test)]
mod tests {
 use super::*;
 fn state(r:Vec<(u64,u64)>)->SavedState { SavedState{url:"https://example.test/file".into(),size:100,etag:Some("\"v1\"".into()),last_modified:None,segments:r} }
 #[test] fn rejects_overlapping_and_out_of_bounds_ranges(){assert!(!state(vec![(0,60),(50,90)]).valid_ranges());assert!(!state(vec![(0,101)]).valid_ranges());assert!(!state(vec![(20,20)]).valid_ranges());assert!(state(vec![(80,100),(0,40)]).valid_ranges());assert!(state(vec![]).valid_ranges());}
 #[test] fn resume_requires_same_validator(){let s=state(vec![(0,100)]);assert!(s.matches(&s.url,100,&s.etag,&None));assert!(!s.matches(&s.url,100,&None,&None));assert!(!s.matches(&s.url,100,&Some("different".into()),&None));}
}
