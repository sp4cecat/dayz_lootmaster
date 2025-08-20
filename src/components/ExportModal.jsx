import React from 'react';

/**
 * @param {{ xml: string, onClose: () => void }} props
 */
export default function ExportModal({ xml, onClose }) {
  const onCopy = async () => {
    await navigator.clipboard.writeText(xml);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal full">
        <div className="modal-header">
          <h3>Export types.xml</h3>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={onCopy}>Copy</button>
        </div>
        <textarea className="code-view" readOnly value={xml} />
      </div>
    </div>
  );
}
