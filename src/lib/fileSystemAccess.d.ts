// Minimal ambient types for the File System Access API pickers (showOpenFilePicker /
// showSaveFilePicker). TypeScript's bundled lib.dom.d.ts ships FileSystemFileHandle and
// FileSystemWritableFileStream, but not the pickers (still a Chromium-only, non-standard
// extension), so this app declares just the picker surface it actually calls.

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
