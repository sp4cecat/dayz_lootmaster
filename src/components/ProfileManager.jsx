import React, { useState } from 'react';
import { Button } from './ui/Button';
import { cn } from '../utils/cn';

export default function ProfileManager({ 
    profiles, 
    selectedProfileId, 
    onSelect, 
    getApiBase 
}) {
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [name, setName] = useState('');
    const [serverPath, setServerPath] = useState('');
    const [missionName, setMissionName] = useState('');
    const [missions, setMissions] = useState([]);
    const [loadingMissions, setLoadingMissions] = useState(false);
    const [error, setError] = useState(null);

    const API_BASE = getApiBase();

    const scanMissions = async (path) => {
        if (!path) return;
        setLoadingMissions(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/scan-missions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ serverPath: path })
            });
            const data = await res.json();
            if (res.ok) {
                const missionList = Array.isArray(data) ? data : (data.missions || []);
                setMissions(missionList);
                if (data.warning) {
                    setError(data.warning);
                }
                if (missionList.length > 0 && !missionName) {
                    setMissionName(missionList[0]);
                }
            } else {
                setError(data.error || 'Failed to scan missions at the given path.');
                setMissions([]);
            }
        } catch (e) {
            setError('Error connecting to server: ' + e.message);
            setMissions([]);
        } finally {
            setLoadingMissions(false);
        }
    };

    const handleSave = async () => {
        if (!name || !serverPath || !missionName) {
            setError('Please fill in all fields.');
            return;
        }

        const payload = { name, serverPath, missionName };
        try {
            let res;
            if (editingId) {
                res = await fetch(`${API_BASE}/api/profiles/${editingId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            } else {
                res = await fetch(`${API_BASE}/api/profiles`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
            }

            if (res.ok) {
                const saved = await res.json();
                setIsAdding(false);
                setEditingId(null);
                setName('');
                setServerPath('');
                setMissionName('');
                setMissions([]);
                onSelect(saved.id);
                // Refreshing profiles is handled by useLootData's useEffect on profiles endpoint
                // but we might need to trigger a reload if useLootData doesn't auto-poll
                window.location.reload(); // Simple way to reset state with new profile
            } else {
                const data = await res.json();
                setError(data.error || 'Failed to save profile.');
            }
        } catch {
            setError('Error saving profile.');
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('Are you sure you want to delete this profile?')) return;
        try {
            const res = await fetch(`${API_BASE}/api/profiles/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                if (selectedProfileId === id) {
                    onSelect('');
                }
                window.location.reload();
            }
        } catch {
            setError('Error deleting profile.');
        }
    };

    const startEdit = (p) => {
        setEditingId(p.id);
        setName(p.name);
        setServerPath(p.serverPath);
        setMissionName(p.missionName);
        setIsAdding(true);
        scanMissions(p.serverPath);
    };

    return (
        <div className="profile-manager">
            {error && <div className="p-3 mb-4 text-sm text-error-600 bg-error-50 rounded-lg dark:bg-error-900/20 dark:text-error-400">{error}</div>}

            {!isAdding ? (
                <>
                    <div className="space-y-3">
                        {profiles.length === 0 ? (
                            <p className="text-gray-500 text-center py-8 italic dark:text-gray-400">No server installations configured yet.</p>
                        ) : (
                            profiles.map(p => (
                                <div 
                                    key={p.id} 
                                    className={cn(
                                        "flex items-center justify-between p-4 bg-white border rounded-xl transition-all dark:bg-gray-800",
                                        p.id === selectedProfileId ? "border-primary-500 ring-1 ring-primary-500" : "border-gray-200 hover:border-gray-300 dark:border-gray-700"
                                    )}
                                >
                                    <div className="min-w-0">
                                        <p className="font-bold text-gray-900 truncate dark:text-white">{p.name}</p>
                                        <p className="text-xs text-gray-500 truncate dark:text-gray-400">{p.serverPath}</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5 truncate uppercase tracking-wider font-semibold">Mission: {p.missionName}</p>
                                    </div>
                                    <div className="flex items-center gap-2 ml-4">
                                        <Button 
                                            variant={p.id === selectedProfileId ? "primary" : "secondary"} 
                                            size="sm"
                                            onClick={() => onSelect(p.id)} 
                                            disabled={p.id === selectedProfileId}
                                        >
                                            {p.id === selectedProfileId ? 'Active' : 'Select'}
                                        </Button>
                                        <Button variant="secondary" size="sm" onClick={() => startEdit(p)}>Edit</Button>
                                        <Button variant="error" size="sm" onClick={() => handleDelete(p.id)}>Delete</Button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <Button className="w-full mt-6" onClick={() => setIsAdding(true)}>
                        + Add Server Installation
                    </Button>
                </>
            ) : (
                <div className="space-y-6">
                    <h4 className="text-lg font-bold text-gray-900 dark:text-white">{editingId ? 'Edit Installation' : 'Add New Installation'}</h4>
                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Friendly Name</label>
                            <input 
                                type="text" 
                                value={name} 
                                onChange={e => setName(e.target.value)} 
                                placeholder="e.g. My Local Deerisle Server" 
                                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-4 focus:ring-primary-100 outline-none transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30" 
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Server Root Path</label>
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    value={serverPath} 
                                    onChange={e => setServerPath(e.target.value)} 
                                    placeholder="C:\DayZServer" 
                                    className="flex-1 px-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-4 focus:ring-primary-100 outline-none transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30" 
                                />
                                <Button variant="secondary" onClick={() => scanMissions(serverPath)} disabled={loadingMissions}>
                                    Scan
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">Mission</label>
                            <select 
                                value={missionName} 
                                onChange={e => setMissionName(e.target.value)} 
                                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg focus:ring-4 focus:ring-primary-100 outline-none transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white dark:focus:ring-primary-900/30" 
                                disabled={missions.length === 0}
                            >
                                {missions.length === 0 && <option>Scan server path to see missions</option>}
                                {missions.map(m => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </div>
                    </div>
                    <div className="flex gap-3 pt-4">
                        <Button className="flex-1" onClick={handleSave}>Save Installation</Button>
                        <Button variant="secondary" onClick={() => { setIsAdding(false); setEditingId(null); setError(null); }}>Cancel</Button>
                    </div>
                </div>
            )}
        </div>
    );
}
