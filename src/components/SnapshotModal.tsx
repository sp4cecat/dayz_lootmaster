import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { Input } from '@/components/base/input/input';
import { 
    Camera, 
    Trash2, 
    RotateCcw, 
    Plus, 
    Calendar, 
    User, 
    AlertTriangle,
    Clock
} from 'lucide-react';
import moment from 'moment';

interface Snapshot {
    id: string;
    name: string;
    description: string;
    timestamp: string;
    editorId: string;
}

interface SnapshotModalProps {
    onClose: () => void;
    selectedProfileId: string;
    getApiBase: () => string;
}

export const SnapshotModal: React.FC<SnapshotModalProps> = ({ 
    onClose, 
    selectedProfileId, 
    getApiBase 
}) => {
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newSnapshot, setNewSnapshot] = useState({ name: '', description: '' });
    const [restoring, setRestoring] = useState<string | null>(null);

    const apiBase = getApiBase();
    const normalizedApiBase = apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase;

    const fetchSnapshots = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${normalizedApiBase}/api/profiles/${selectedProfileId}/snapshots`, {
                headers: { 'x-profile-id': selectedProfileId }
            });
            if (res.ok) {
                const data = await res.json();
                setSnapshots(data);
            }
        } catch (err) {
            console.error('Failed to fetch snapshots', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedProfileId) {
            fetchSnapshots();
        }
    }, [selectedProfileId, apiBase]);

    const handleCreate = async () => {
        if (!newSnapshot.name.trim()) return;
        setCreating(true);
        try {
            const res = await fetch(`${normalizedApiBase}/api/profiles/${selectedProfileId}/snapshots`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-editor-id': localStorage.getItem('dayz-editor:id') || 'unknown',
                    'x-profile-id': selectedProfileId
                },
                body: JSON.stringify(newSnapshot)
            });
            if (res.ok) {
                setNewSnapshot({ name: '', description: '' });
                fetchSnapshots();
            }
        } catch (err) {
            console.error('Failed to create snapshot', err);
        } finally {
            setCreating(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this snapshot? This cannot be undone.')) return;
        try {
            const res = await fetch(`${normalizedApiBase}/api/profiles/${selectedProfileId}/snapshots/${id}`, {
                method: 'DELETE',
                headers: { 'x-profile-id': selectedProfileId }
            });
            if (res.ok) {
                fetchSnapshots();
            }
        } catch (err) {
            console.error('Failed to delete snapshot', err);
        }
    };

    const handleRestore = async (id: string) => {
        const s = snapshots.find(x => x.id === id);
        if (!window.confirm(`Are you sure you want to restore snapshot "${s?.name}"? \n\nThis will overwrite ALL current CLE files and Random Presets. A pre-restore snapshot will be created automatically.`)) return;
        
        setRestoring(id);
        try {
            const res = await fetch(`${normalizedApiBase}/api/profiles/${selectedProfileId}/snapshots/${id}/restore`, {
                method: 'POST',
                headers: { 
                    'x-profile-id': selectedProfileId,
                    'x-editor-id': localStorage.getItem('dayz-editor:id') || 'unknown'
                }
            });
            if (res.ok) {
                window.alert('Snapshot restored successfully! The application will now reload.');
                window.location.reload();
            } else {
                const err = await res.json();
                window.alert(`Failed to restore snapshot: ${err.error}`);
            }
        } catch (err) {
            console.error('Failed to restore snapshot', err);
        } finally {
            setRestoring(null);
        }
    };

    const footer = (
        <Button variant="secondary-gray" onClick={onClose}>Close</Button>
    );

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title="Server Profile Snapshots"
            description="Create and manage snapshots of your CLE configurations and mission files."
            footer={footer}
        >
            <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2 scrollbar-thin">
                {/* Create Section */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 space-y-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                        <Plus size={18} className="text-primary-600" />
                        Create New Snapshot
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Input 
                            label="Snapshot Name" 
                            placeholder="e.g. Pre-Wipe Stable" 
                            value={newSnapshot.name}
                            onChange={e => setNewSnapshot(prev => ({ ...prev, name: e.target.value }))}
                        />
                        <Input 
                            label="Description (Optional)" 
                            placeholder="Reason for snapshot..." 
                            value={newSnapshot.description}
                            onChange={e => setNewSnapshot(prev => ({ ...prev, description: e.target.value }))}
                        />
                    </div>
                    <div className="flex justify-end">
                        <Button 
                            onClick={handleCreate} 
                            disabled={!newSnapshot.name.trim() || creating}
                            icon={Camera}
                        >
                            {creating ? 'Creating...' : 'Take Snapshot'}
                        </Button>
                    </div>
                </div>

                {/* List Section */}
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                            <Clock size={18} className="text-gray-400" />
                            Previous Snapshots
                        </h3>
                        <Badge color="gray">{snapshots.length} total</Badge>
                    </div>

                    {loading ? (
                        <div className="py-12 flex flex-col items-center justify-center text-gray-500">
                            <div className="size-8 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin mb-4" />
                            Loading snapshots...
                        </div>
                    ) : snapshots.length === 0 ? (
                        <div className="py-12 text-center bg-white border border-dashed border-gray-300 rounded-xl dark:bg-gray-900 dark:border-gray-800">
                            <Camera size={48} className="mx-auto text-gray-300 mb-4" />
                            <p className="text-gray-500">No snapshots found for this profile.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {snapshots.map(s => (
                                <div 
                                    key={s.id}
                                    className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white border border-gray-200 rounded-xl hover:border-primary-300 transition-all shadow-sm dark:bg-gray-800 dark:border-gray-700 dark:hover:border-primary-600"
                                >
                                    <div className="flex-1 min-w-0 pr-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="font-bold text-gray-900 truncate dark:text-white" title={s.name}>{s.name}</span>
                                            {s.name.startsWith('Pre-restore:') && (
                                                <Badge color="warning" size="sm">Auto-backup</Badge>
                                            )}
                                        </div>
                                        {s.description && (
                                            <p className="text-sm text-gray-500 truncate mb-2 dark:text-gray-400">{s.description}</p>
                                        )}
                                        <div className="flex items-center gap-4 text-xs text-gray-400">
                                            <div className="flex items-center gap-1">
                                                <Calendar size={12} />
                                                {moment(s.timestamp).fromNow()}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <User size={12} />
                                                {s.editorId}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 mt-4 sm:mt-0 border-t sm:border-t-0 pt-3 sm:pt-0">
                                        <Button 
                                            variant="secondary-gray" 
                                            size="sm" 
                                            icon={RotateCcw}
                                            onClick={() => handleRestore(s.id)}
                                            disabled={!!restoring}
                                        >
                                            {restoring === s.id ? 'Restoring...' : 'Restore'}
                                        </Button>
                                        <Button 
                                            variant="tertiary" 
                                            size="sm" 
                                            className="text-error-600 hover:text-error-700 hover:bg-error-50 dark:text-error-400 dark:hover:bg-error-900/30"
                                            onClick={() => handleDelete(s.id)}
                                            disabled={!!restoring}
                                        >
                                            <Trash2 size={18} />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 bg-warning-50 rounded-xl border border-warning-200 flex gap-3 dark:bg-warning-900/10 dark:border-warning-800">
                    <AlertTriangle className="text-warning-600 shrink-0" size={20} />
                    <div className="text-xs text-warning-800 dark:text-warning-300">
                        <p className="font-bold mb-1 text-sm">Warning on Restore</p>
                        Restoring a snapshot will completely replace your current mission files on the server. Always ensure you have backed up your current state if you're unsure. The system creates an automatic "Pre-restore" snapshot for safety.
                    </div>
                </div>
            </div>
        </Modal>
    );
};
