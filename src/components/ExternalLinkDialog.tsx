import Dialog from "./Dialog";
import { CloseIcon } from "./Icons";

export default function ExternalLinkDialog({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <Dialog label="You are leaving this preview" className="external-dialog" onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <h2>You are leaving this preview</h2>
        <button autoFocus type="button" onClick={onClose} aria-label="Close dialog"><CloseIcon /></button>
      </div>
      <p>You are about to open <strong>{new URL(url).hostname}</strong> in a new tab.</p>
      <div className="flex flex-wrap items-center gap-4">
        <a className="wf-button wf-button-red" href={url} target="_blank" rel="noopener noreferrer" onClick={onClose}>Continue</a>
        <button type="button" className="wf-button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}