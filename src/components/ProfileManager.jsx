import React, { useState } from 'react';

export default function ProfileManager({ 
    profiles, 
    selectedProfileId, 
    onSelect, 
    onClose,
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
            if (res.ok) {
                const data = await res.json();
                setMissions(data);
                if (data.length > 0 && !missionName) {
                    setMissionName(data[0]);
                }
            } else {
                setError('Failed to scan missions at the given path.');
                setMissions([]);
            }
        } catch {
            setError('Error connecting to server.');
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
        <div className="modal-overlay">
            <div className="modal-content profile-manager" style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <h3>Manage Server Installations</h3>
                    <button className="close-button" onClick={onClose}>&times;</button>
                </div>
                <div className="modal-body">
                    {error && <div className="error-message" style={{ color: 'red', marginBottom: '1rem' }}>{error}</div>}

                    {!isAdding ? (
                        <>
                            <div className="profile-list">
                                {profiles.length === 0 ? (
                                    <p>No server installations configured yet.</p>
                                ) : (
                                    profiles.map(p => (
                                        <div key={p.id} className={`profile-item ${p.id === selectedProfileId ? 'selected' : ''}`} 
                                             style={{ border: '1px solid #ccc', padding: '10px', marginBottom: '10px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <strong>{p.name}</strong><br/>
                                                <small style={{ color: '#666' }}>{p.serverPath}</small><br/>
                                                <small style={{ color: '#666' }}>Mission: {p.missionName}</small>
                                            </div>
                                            <div className="actions">
                                                <button onClick={() => onSelect(p.id)} disabled={p.id === selectedProfileId} className="btn-small">
                                                    {p.id === selectedProfileId ? 'Selected' : 'Select'}
                                                </button>
                                                <button onClick={() => startEdit(p)} className="btn-small">Edit</button>
                                                <button onClick={() => handleDelete(p.id)} className="btn-small btn-danger">Delete</button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={() => setIsAdding(true)}>
                                + Add Server Installation
                            </button>
                        </>
                    ) : (
                        <div className="add-profile-form">
                            <h4>{editingId ? 'Edit Installation' : 'Add New Installation'}</h4>
                            <div className="form-group" style={{ marginBottom: '10px' }}>
                                <label>Friendly Name:</label>
                                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My Local Deerisle Server" style={{ width: '100%', padding: '8px' }} />
                            </div>
                            <div className="form-group" style={{ marginBottom: '10px' }}>
                                <label>Server Root Path:</label>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <input type="text" value={serverPath} onChange={e => setServerPath(e.target.value)} placeholder="C:\DayZServer" style={{ flex: 1, padding: '8px' }} />
                                    <button onClick={() => scanMissions(serverPath)} disabled={loadingMissions}>Scan</button>
                                </div>
                            </div>
                            <div className="form-group" style={{ marginBottom: '10px' }}>
                                <label>Mission:</label>
                                <select value={missionName} onChange={e => setMissionName(e.target.value)} style={{ width: '100%', padding: '8px' }} disabled={missions.length === 0}>
                                    {missions.length === 0 && <option>Scan server path to see missions</option>}
                                    {missions.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <div className="form-actions" style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                                <button className="btn-primary" onClick={handleSave}>Save</button>
                                <button onClick={() => { setIsAdding(false); setEditingId(null); setError(null); }}>Cancel</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
