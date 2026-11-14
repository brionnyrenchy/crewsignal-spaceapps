//! Holds the SQLite database behind a recoverable slot.
//!
//! Startup never panics on storage problems: if the app-data directory cannot be
//! resolved or the database cannot be opened (denied, locked, unreadable), the
//! app still launches with bundled Help and a recovery screen. The original
//! database file is never renamed, deleted or recreated here; `retry` simply
//! tries to open the same path again once access returns.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use crate::db::Database;
use crate::models::{CommandError, StorageStatus};

pub struct StorageSlot {
    path: Option<PathBuf>,
    db: RwLock<Option<Arc<Database>>>,
    last_error: Mutex<Option<CommandError>>,
}

impl StorageSlot {
    /// Attempts to open `path`. A `None` path means the app-data directory could
    /// not be resolved; `path_error` then explains why.
    pub fn open(path: Option<PathBuf>, path_error: Option<CommandError>) -> Self {
        let slot = Self {
            path,
            db: RwLock::new(None),
            last_error: Mutex::new(path_error),
        };
        slot.try_open();
        slot
    }

    fn try_open(&self) {
        let Some(path) = self.path.as_ref() else {
            return;
        };
        match Database::open_file(path) {
            Ok(db) => {
                if let Ok(mut guard) = self.db.write() {
                    *guard = Some(Arc::new(db));
                }
                if let Ok(mut err) = self.last_error.lock() {
                    *err = None;
                }
            }
            Err(e) => {
                if let Ok(mut err) = self.last_error.lock() {
                    *err = Some(e);
                }
            }
        }
    }

    /// Returns the open database or a typed `STORAGE_UNAVAILABLE` error that the
    /// frontend routes to its recovery screen.
    pub fn get(&self) -> Result<Arc<Database>, CommandError> {
        if let Ok(guard) = self.db.read() {
            if let Some(db) = guard.as_ref() {
                return Ok(Arc::clone(db));
            }
        }
        let cause = self
            .last_error
            .lock()
            .ok()
            .and_then(|e| e.clone())
            .map(|e| match e.detail {
                Some(d) => format!("{}: {}", e.code, d),
                None => e.code,
            })
            .unwrap_or_else(|| "UNKNOWN".to_string());
        Err(CommandError::with_detail(
            "STORAGE_UNAVAILABLE",
            "Local storage could not be opened. Your saved file was left unchanged.",
            cause,
        ))
    }

    pub fn status(&self) -> StorageStatus {
        let available = self.db.read().map(|g| g.is_some()).unwrap_or(false);
        let err = self.last_error.lock().ok().and_then(|e| e.clone());
        StorageStatus {
            available,
            code: if available { None } else { err.as_ref().map(|e| e.code.clone()) },
            message: if available { None } else { err.as_ref().map(|e| e.message.clone()) },
            detail: if available { None } else { err.and_then(|e| e.detail) },
            db_path: self.path.as_ref().map(|p| p.display().to_string()),
        }
    }

    /// Re-attempts opening the same file. Already-open storage is left as is.
    pub fn retry(&self) -> StorageStatus {
        let available = self.db.read().map(|g| g.is_some()).unwrap_or(false);
        if !available {
            self.try_open();
        }
        self.status()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn unreadable_database_leaves_file_untouched_and_reports_unavailable() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("crewsignal.db");
        let garbage = b"this is not a sqlite database, it must survive startup".repeat(64);
        std::fs::write(&path, &garbage).unwrap();

        let slot = StorageSlot::open(Some(path.clone()), None);
        let status = slot.status();
        assert!(!status.available);
        assert!(status.code.is_some());
        let err = slot.get().err().expect("storage must be unavailable");
        assert_eq!(err.code, "STORAGE_UNAVAILABLE");

        // The original file is preserved byte for byte.
        assert_eq!(std::fs::read(&path).unwrap(), garbage);
        // A retry against the same unreadable file stays unavailable and still preserves it.
        assert!(!slot.retry().available);
        assert_eq!(std::fs::read(&path).unwrap(), garbage);
    }

    #[test]
    fn denied_storage_recovers_on_retry_when_access_returns() {
        let dir = tempdir().unwrap();
        // A plain file where the app-data folder should be makes the directory unusable.
        let blocker = dir.path().join("appdata");
        std::fs::write(&blocker, b"blocking file").unwrap();
        let path = blocker.join("crewsignal.db");

        let slot = StorageSlot::open(Some(path.clone()), None);
        assert!(!slot.status().available);
        assert_eq!(slot.get().err().unwrap().code, "STORAGE_UNAVAILABLE");

        // Access returns: the blocking file is gone, so the folder can be created.
        std::fs::remove_file(&blocker).unwrap();
        let status = slot.retry();
        assert!(status.available, "retry should open storage: {status:?}");
        assert!(slot.get().is_ok());
        assert!(path.exists());
    }

    #[test]
    fn missing_app_data_directory_is_reported_without_panicking() {
        let slot = StorageSlot::open(
            None,
            Some(CommandError::new("APP_DATA_DIR_UNAVAILABLE", "No app data directory.")),
        );
        let status = slot.status();
        assert!(!status.available);
        assert_eq!(status.code.as_deref(), Some("APP_DATA_DIR_UNAVAILABLE"));
        assert!(!slot.retry().available);
    }
}
