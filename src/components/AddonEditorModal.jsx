import React, { useEffect, useState } from 'react';

export default function AddonEditorModal({ addonId, addonName, onClose, selectedProfileId, getApiBase }) {
    const API_BASE = getApiBase();
    const [fileNames, setFileNames] = useState([]);
    const [selectedFile, setSelectedFile] = useState('');
    const [fileContent, setFileContent] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/addons/${addonId}/files`, {
                    headers: { 'X-Profile-ID': selectedProfileId }
                });
                const names = await res.json();
                setFileNames(names);
                if (names.length > 0) setSelectedFile(names[0]);
            } catch (e) {
                setError(`Failed to load ${addonName} files: ${e.message}`);
            }
        })();
    }, [API_BASE, addonId, addonName, selectedProfileId]);

    useEffect(() => {
        if (!selectedFile) {
            setFileContent('');
            return;
        }
        (async () => {
            try {
                setBusy(true);
                setError(null);
                setNotice(null);
                const res = await fetch(`${API_BASE}/api/addons/${addonId}/file/${encodeURIComponent(selectedFile)}`, {
                    headers: { 'X-Profile-ID': selectedProfileId }
                });
                if (!res.ok) throw new Error(`Failed to load file ${selectedFile}`);
                const json = await res.json();
                setFileContent(JSON.stringify(json, null, 4));
            } catch (e) {
                setError(String(e));
                setFileContent('');
            } finally {
                setBusy(false);
            }
        })();
    }, [API_BASE, addonId, selectedFile, selectedProfileId]);

    const handleSave = async () => {
        if (!selectedFile || !fileContent) return;
        try {
            setBusy(true);
            setError(null);
            setNotice(null);
            
            // Validate JSON before sending
            let parsed;
            try {
                parsed = JSON.parse(fileContent);
            } catch (e) {
                throw new Error(`Invalid JSON: ${e.message}`);
            }

            const res = await fetch(`${API_BASE}/api/addons/${addonId}/file/${encodeURIComponent(selectedFile)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Profile-ID': selectedProfileId
                },
                body: JSON.stringify(parsed)
            });

            if (res.ok) {
                setNotice('File saved successfully.');
            } else {
                const data = await res.json();
                throw new Error(data.error || 'Failed to save file.');
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal fullscreen-modal">
                <div className="modal-header">
                    <h3>{addonName} Configuration</h3>
                    <div className="spacer" />
                    <button className="btn" onClick={onClose}>Close</button>
                </div>
                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div className="controls-row" style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                        <label className="control" style={{ flex: 1 }}>
                            <span>Select Configuration File</span>
                            <select value={selectedFile} onChange={e => setSelectedFile(e.target.value)} disabled={busy}>
                                {fileNames.map(n => <option key={n} value={n}>{n}.json</option>)}
                            </select>
                        </label>
                        <button className="btn primary" onClick={handleSave} disabled={busy || !selectedFile}>
                            {busy ? 'Saving...' : 'Save File'}
                        </button>
                    </div>

                    {error && <div className="banner error">{error}</div>}
                    {notice && (
                        <div className="banner">
                            {notice}
                            <div className="spacer" />
                            <button className="link" onClick={() => setNotice(null)}>Dismiss</button>
                        </div>
                    )}

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        <label className="control" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <span>File Content (JSON)</span>
                            <textarea
                                value={fileContent}
                                onChange={e => setFileContent(e.target.value)}
                                style={{ 
                                    flex: 1, 
                                    fontFamily: 'monospace', 
                                    fontSize: '14px', 
                                    padding: '10px',
                                    backgroundColor: 'var(--bg-input, #fff)',
                                    color: 'var(--text-input, #000)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '4px',
                                    resize: 'none'
                                }}
                                spellCheck="false"
                                disabled={busy}
                            />
                        </label>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
