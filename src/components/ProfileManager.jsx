import React, { useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { cn } from '../utils/cn';
import { Server, Plus, Edit2, Trash2, Check, ExternalLink, Folder, Map as MapIcon, ChevronRight, AlertCircle } from 'lucide-react';
import { Badge } from './base/badges/badges';

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
                window.location.reload(); 
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

    const handleEdit = (p) => {
        setEditingId(p.id);
        setName(p.name);
        setServerPath(p.serverPath);
        setMissionName(p.missionName);
        setIsAdding(true);
        scanMissions(p.serverPath);
    };

    if (isAdding) {
        return (
            <div className="p-8 space-y-8 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div className="flex items-center gap-3 mb-2">
                    <div className="size-10 bg-primary-100 rounded-lg flex items-center justify-center text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                        <Plus size={20} />
                    </div>
                    <div>
                        <h4 className="text-xl font-bold text-gray-900 dark:text-white">
                            {editingId ? 'Edit Profile' : 'Add New Server'}
                        </h4>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Configure your mission and server details.</p>
                    </div>
                </div>

                <div className="space-y-6 bg-white p-6 rounded-xl border border-gray-200 shadow-sm dark:bg-gray-800/50 dark:border-gray-700">
                    <Input 
                        label="Display Name" 
                        placeholder="e.g. My Survival Server" 
                        value={name} 
                        onChange={e => setName(e.target.value)}
                        hint="A friendly name to identify this server."
                    />

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Server Root Path</label>
                        <div className="flex gap-2">
                            <Input 
                                placeholder="C:\DayZServer or /opt/dayz" 
                                value={serverPath} 
                                onChange={e => setServerPath(e.target.value)}
                                className="flex-1"
                            />
                            <Button 
                                variant="secondary-gray" 
                                onClick={() => scanMissions(serverPath)}
                                disabled={loadingMissions || !serverPath}
                                size="md"
                            >
                                {loadingMissions ? 'Scanning...' : 'Scan'}
                            </Button>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">The absolute path to your server installation.</p>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Mission Folder</label>
                        <select 
                            className="w-full h-10 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-4 focus:ring-primary-100 focus:border-primary-300 transition-all dark:bg-gray-950 dark:border-gray-700 dark:text-white"
                            value={missionName} 
                            onChange={e => setMissionName(e.target.value)}
                            disabled={missions.length === 0}
                        >
                            {missions.length === 0 && <option value="">Scan server path first...</option>}
                            {missions.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Select the active mission folder (e.g. dayzOffline.chernarusplus)</p>
                    </div>

                    {error && (
                        <div className="p-3 bg-error-50 border border-error-100 rounded-lg flex items-center gap-2 text-error-700 text-sm dark:bg-error-900/10 dark:border-error-900/20 dark:text-error-400">
                            <AlertCircle size={16} />
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex gap-3">
                    <Button variant="primary" className="flex-1" onClick={handleSave} size="lg">
                        {editingId ? 'Update Profile' : 'Create Profile'}
                    </Button>
                    <Button variant="secondary-gray" onClick={() => { setIsAdding(false); setEditingId(null); setError(null); }} size="lg">
                        Cancel
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="text-lg font-bold text-gray-900 dark:text-white">Active Profiles</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Select a server to manage its economy.</p>
                </div>
                <Button variant="primary" size="md" icon={Plus} onClick={() => setIsAdding(true)}>
                    Add Server
                </Button>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {profiles.length === 0 && (
                    <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 dark:bg-gray-800/30 dark:border-gray-700">
                        <div className="size-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 mx-auto mb-4 dark:bg-gray-800">
                            <Server size={24} />
                        </div>
                        <h5 className="font-bold text-gray-900 dark:text-white">No profiles yet</h5>
                        <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">Add your first server profile to get started.</p>
                        <Button variant="link" className="mt-4" onClick={() => setIsAdding(true)}>Add your first server</Button>
                    </div>
                )}
                {profiles.map(p => {
                    const isSelected = p.id === selectedProfileId;
                    return (
                        <div 
                            key={p.id}
                            className={cn(
                                "group relative flex items-center gap-4 p-5 rounded-2xl border transition-all",
                                isSelected 
                                    ? "bg-primary-50 border-primary-200 ring-1 ring-primary-200 dark:bg-primary-900/10 dark:border-primary-800" 
                                    : "bg-white border-gray-200 hover:border-primary-200 hover:shadow-md dark:bg-gray-800/50 dark:border-gray-700 dark:hover:border-primary-800"
                            )}
                        >
                            <div className={cn(
                                "size-12 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                                isSelected ? "bg-primary-600 text-white shadow-sm" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 group-hover:bg-primary-100 group-hover:text-primary-600"
                            )}>
                                <Server size={24} />
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <h5 className="font-bold text-gray-900 truncate dark:text-white">{p.name}</h5>
                                    {isSelected && <Badge color="brand" size="sm">Active</Badge>}
                                </div>
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <Folder size={12} />
                                        <span className="truncate">{p.serverPath}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                        <MapIcon size={12} />
                                        <span className="truncate">{p.missionName}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {!isSelected && (
                                    <Button 
                                        variant="secondary-gray" 
                                        size="sm" 
                                        onClick={() => onSelect(p.id)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        Select
                                    </Button>
                                )}
                                <div className="flex items-center bg-gray-50 rounded-lg p-1 dark:bg-gray-900 border border-gray-100 dark:border-gray-800">
                                    <Button variant="tertiary" size="sm" className="h-8 w-8 p-0" onClick={() => handleEdit(p)} title="Edit">
                                        <Edit2 size={14} />
                                    </Button>
                                    <Button variant="tertiary" size="sm" className="h-8 w-8 p-0 text-error-600 hover:text-error-700 dark:text-error-400 dark:hover:text-error-300" onClick={() => handleDelete(p.id)} title="Delete">
                                        <Trash2 size={14} />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
