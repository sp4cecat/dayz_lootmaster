import { useEffect, useState } from 'react';
import { Modal } from './base/modal/modal';
import { Button } from './base/button/button';
import { Select } from './base/select/select';
import { FileCode01, Save01, AlertCircle, CheckCircle } from '@untitledui/icons';
import { cx } from '@/utils/cx';

interface AddonEditorModalProps {
    addonId: string;
    addonName: string;
    onClose: () => void;
    selectedProfileId: string;
    getApiBase: () => string;
}

export default function AddonEditorModal({ addonId, addonName, onClose, selectedProfileId, getApiBase }: AddonEditorModalProps) {
    const API_BASE = getApiBase();
    const [fileNames, setFileNames] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState('');
    const [fileContent, setFileContent] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API_BASE}/api/addons/${addonId}/files`, {
                    headers: { 'X-Profile-ID': selectedProfileId }
                });
                const names = await res.json();
                setFileNames(names);
                if (names.length > 0) setSelectedFile(names[0]);
            } catch (e: any) {
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
            } catch (e: any) {
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
            
            let parsed;
            try {
                parsed = JSON.parse(fileContent);
            } catch (e: any) {
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
        } catch (e: any) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={`${addonName} Configuration`}
            description={`Edit and manage configuration files for the ${addonName} addon.`}
            icon={FileCode01}
            maxWidth="max-w-none w-[90vw]"
            className="h-[90vh]"
            footer={
                <div className="flex gap-3">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                    <Button variant="primary" onClick={handleSave} disabled={busy || !selectedFile} icon={Save01}>
                        {busy ? 'Saving...' : 'Save File'}
                    </Button>
                </div>
            }
        >
            <div className="flex flex-col h-full space-y-4">
                <div className="bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
                    <Select 
                        label="Configuration File" 
                        value={selectedFile} 
                        onChange={e => setSelectedFile(e.target.value)} 
                        disabled={busy}
                        options={fileNames.map(n => ({ label: `${n}.json`, value: n }))}
                        className="max-w-md"
                    />
                </div>

                {error && (
                    <div className="p-3 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700 flex items-center gap-2 dark:bg-error-900/20 dark:border-error-800 dark:text-error-400">
                        <AlertCircle size={18} />
                        {error}
                    </div>
                )}
                {notice && (
                    <div className="p-3 bg-success-50 border border-success-200 rounded-lg text-sm text-success-700 flex items-center justify-between dark:bg-success-900/20 dark:border-success-800 dark:text-success-400">
                        <div className="flex items-center gap-2">
                            <CheckCircle size={18} />
                            {notice}
                        </div>
                        <button onClick={() => setNotice(null)} className="text-xs font-bold uppercase hover:underline">Dismiss</button>
                    </div>
                )}

                <div className="flex-1 flex flex-col min-h-0">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 flex items-center justify-between">
                        <span>File Content (JSON)</span>
                        <span className="text-xs font-normal text-gray-500">Syntax-highlighted editor pending</span>
                    </label>
                    <textarea
                        value={fileContent}
                        onChange={e => setFileContent(e.target.value)}
                        className={cx(
                            "flex-1 p-4 font-mono text-sm rounded-xl border transition-all focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300",
                            "bg-white dark:bg-gray-950 border-gray-200 dark:border-gray-800 text-gray-900 dark:text-gray-100",
                            "scrollbar-thin resize-none"
                        )}
                        spellCheck="false"
                        disabled={busy}
                    />
                </div>
            </div>
        </Modal>
    );
}
