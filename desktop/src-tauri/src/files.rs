use std::fs::{self, File};
use std::io::{ErrorKind, Write};
use std::path::Path;

use crate::models::{FileReadOutcome, FileWriteOutcome};

/// Write UTF-8 content to a user-selected destination path and fsync it before confirming.
/// Never discards caller state on refusal/failure; returns structured native outcomes.
pub fn write_text_to_path(path: &Path, content: &str) -> FileWriteOutcome {
    let display_path = path.display().to_string();
    let bytes = content.as_bytes();

    match File::create(path) {
        Ok(mut file) => {
            if let Err(err) = file.write_all(bytes) {
                return map_write_io_error(&display_path, err);
            }
            if let Err(err) = file.sync_all() {
                return map_write_io_error(&display_path, err);
            }
            FileWriteOutcome {
                status: "saved".to_string(),
                path: Some(display_path),
                bytes_written: Some(bytes.len()),
                message: None,
            }
        }
        Err(err) => map_write_io_error(&display_path, err),
    }
}

pub fn read_text_from_path(path: &Path) -> FileReadOutcome {
    let display_path = path.display().to_string();
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string());

    match fs::read_to_string(path) {
        Ok(content) => FileReadOutcome {
            status: "loaded".to_string(),
            path: Some(display_path),
            file_name,
            content: Some(content),
            message: None,
        },
        Err(err) => {
            let status = if err.kind() == ErrorKind::PermissionDenied {
                "permission_refused"
            } else {
                "error"
            };
            FileReadOutcome {
                status: status.to_string(),
                path: Some(display_path),
                file_name,
                content: None,
                message: Some(err.to_string()),
            }
        }
    }
}

fn map_write_io_error(display_path: &str, err: std::io::Error) -> FileWriteOutcome {
    let status = if err.kind() == ErrorKind::PermissionDenied {
        "permission_refused"
    } else {
        "error"
    };
    FileWriteOutcome {
        status: status.to_string(),
        path: Some(display_path.to_string()),
        bytes_written: None,
        message: Some(err.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{read_text_from_path, write_text_to_path};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn write_and_read_file_succeeds_with_exact_bytes() {
        let dir = tempdir().expect("tempdir");
        let target = dir.path().join("crewsignal-report-demo.json");
        let payload = "{\"kind\":\"crewsignal-report\",\"schemaVersion\":1}";

        let write_outcome = write_text_to_path(&target, payload);
        assert_eq!(write_outcome.status, "saved");
        assert_eq!(write_outcome.bytes_written, Some(payload.len()));
        assert_eq!(write_outcome.path.as_deref(), Some(target.to_string_lossy().as_ref()));

        let read_outcome = read_text_from_path(&target);
        assert_eq!(read_outcome.status, "loaded");
        assert_eq!(read_outcome.content.as_deref(), Some(payload));
    }

    #[test]
    fn write_to_missing_directory_returns_error_outcome() {
        let dir = tempdir().expect("tempdir");
        let missing = dir.path().join("does-not-exist").join("report.json");
        let outcome = write_text_to_path(&missing, "{}");
        assert_eq!(outcome.status, "error");
        assert!(outcome.bytes_written.is_none());
        assert!(outcome.message.is_some());
    }

    #[test]
    fn write_to_readonly_file_returns_permission_refused() {
        let dir = tempdir().expect("tempdir");
        let readonly_file = dir.path().join("locked.json");
        fs::write(&readonly_file, "initial").expect("seed file");
        let mut perms = fs::metadata(&readonly_file).expect("meta").permissions();
        perms.set_readonly(true);
        fs::set_permissions(&readonly_file, perms).expect("set readonly");

        let outcome = write_text_to_path(&readonly_file, "updated");
        assert_eq!(outcome.status, "permission_refused");
        assert_eq!(
            fs::read_to_string(&readonly_file).expect("read back"),
            "initial"
        );

        // Cleanup readonly flag so tempdir removes cleanly on Windows
        let mut reset_perms = fs::metadata(&readonly_file).expect("meta").permissions();
        reset_perms.set_readonly(false);
        let _ = fs::set_permissions(&readonly_file, reset_perms);
    }
}
