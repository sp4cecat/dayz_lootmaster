import React, { useState } from 'react';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { cx } from '@/utils/cx';
import { Server, Plus, Edit2, Trash2, Check, ExternalLink, Folder, Map as MapIcon, ChevronRight, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/base/badges/badges';

import { getMapMetadata } from '@/consts/maps';
import { apiFetch } from '@/utils/api';

interface Profile {
  id: string;
  name: string;
  serverPath: string;
  missionName: string;
  addons?: string[];
}

interface ProfileManagerProps {
  profiles: Profile[];
  selectedProfileId: string;
  onSelect: (id: string) => void;
}

export default function ProfileManager({
    profiles,
    selectedProfileId,
    onSelect
}: ProfileManagerProps) {
    const [isAdding, setIsAdding] = useState(false);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [formData, setFormData] = useState({
        name: '',
        serverPath: '',
        missionName: ''
    });

    const resetForm = () => {
        setFormData({ name: '', serverPath: '', missionName: '' });
        setIsAdding(false);
        setEditingProfile(null);
    };

    const handleEdit = (p: Profile) => {
        setEditingProfile(p);
        setFormData({
            name: p.name,
            serverPath: p.serverPath,
            missionName: p.missionName
        });
        setIsAdding(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const method = editingProfile ? 'PUT' : 'POST';
        const path = editingProfile
            ? `/api/profiles/${editingProfile.id}`
            : `/api/profiles`;

        try {
            const res = await apiFetch(path, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });

            if (res.ok) {
                resetForm();
                window.location.reload(); // Refresh to get updated profiles
            }
        } catch (err) {
            console.error('Failed to save profile', err);
        }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('Are you sure you want to delete this profile?')) return;

        try {
            const res = await apiFetch(`/api/profiles/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                window.location.reload();
            }
        } catch (err) {
            console.error('Failed to delete profile', err);
        }
    };

    if (isAdding) {
        return (
            <div className="max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden dark:bg-gray-900 dark:border-gray-800">
                    <div className="p-8 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/20">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="size-10 bg-primary-600 rounded-lg flex items-center justify-center text-white shadow-sm">
                                <Plus size={24} />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                {editingProfile ? 'Edit Profile' : 'Add New Server'}
                            </h2>
                        </div>
                        <p className="text-gray-500 dark:text-gray-400">Configure your server and mission paths to start editing.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="p-8 space-y-6">
                        <Input 
                            label="Display Name"
                            placeholder="e.g. My Survival Server"
                            value={formData.name}
                            onChange={e => setFormData({...formData, name: e.target.value})}
                            required
                        />
                        
                        <div className="space-y-4 p-4 bg-gray-50 rounded-xl border border-gray-100 dark:bg-gray-950/20 dark:border-gray-800">
                            <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 mb-2">
                                <Folder size={18} />
                                <span className="text-sm font-bold uppercase tracking-wider">Path Configuration</span>
                            </div>
                            
                            <Input 
                                label="Server Root Path"
                                placeholder="C:\DayZServer or /home/dayz/server"
                                value={formData.serverPath}
                                onChange={e => setFormData({...formData, serverPath: e.target.value})}
                                hint="The absolute path to your server's root directory."
                                required
                            />
                            
                            <Input 
                                label="Mission Name"
                                placeholder="dayzOffline.chernarusplus"
                                value={formData.missionName}
                                onChange={e => setFormData({...formData, missionName: e.target.value})}
                                hint="The name of your mission folder in mpmissions."
                                required
                            />
                        </div>

                        <div className="flex items-center gap-3 pt-4">
                            <Button type="submit" className="flex-1">
                                {editingProfile ? 'Save Changes' : 'Create Profile'}
                            </Button>
                            <Button variant="secondary-gray" onClick={resetForm}>
                                Cancel
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="animate-in fade-in duration-500">
            {profiles.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300 dark:bg-gray-900 dark:border-gray-800">
                    <div className="size-20 bg-gray-50 rounded-full flex items-center justify-center text-gray-400 mx-auto mb-6 dark:bg-gray-800">
                        <Server size={40} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No Profiles Found</h3>
                    <p className="text-gray-500 max-w-sm mx-auto mb-8 dark:text-gray-400">Get started by adding your first server profile to manage its loot economy.</p>
                    <Button onClick={() => setIsAdding(true)} icon={Plus}>Add First Server</Button>
                </div>
            ) : (
                <div className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Badge color="brand" size="md" type="modern">{profiles.length} Profiles</Badge>
                        </div>
                        <Button variant="secondary-color" icon={Plus} onClick={() => setIsAdding(true)}>Add Server</Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {profiles.map(p => {
                            const isSelected = p.id === selectedProfileId;
                            const mapMetadata = getMapMetadata(p.missionName);
                            return (
                                <div 
                                    key={p.id}
                                    className={cx(
                                        "group relative flex items-center gap-4 p-5 rounded-2xl border transition-all",
                                        isSelected 
                                            ? "bg-primary-50 border-primary-200 ring-1 ring-primary-200 dark:bg-primary-900/10 dark:border-primary-800" 
                                            : "bg-white border-gray-200 hover:border-primary-200 hover:shadow-md dark:bg-gray-800/50 dark:border-gray-700 dark:hover:border-primary-800"
                                    )}
                                >
                                    <div className={cx(
                                        "size-12 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                                        isSelected ? "bg-primary-600 text-white shadow-sm" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 group-hover:bg-primary-100 group-hover:text-primary-600"
                                    )}>
                                        <Server size={24} />
                                    </div>
                                    
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <p className="text-sm font-bold text-gray-900 truncate dark:text-white" title={p.name}>{p.name}</p>
                                            {isSelected && (
                                                <Badge color="success" size="sm">
                                                    <Check size={10} className="mr-1" /> Active
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                                            <div className="flex items-center gap-1" title={p.missionName}>
                                                <MapIcon size={12} />
                                                <span className="truncate">{mapMetadata.displayName}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {isSelected ? (
                                            <button 
                                                className="size-10 flex items-center justify-center text-primary-600 bg-white rounded-lg shadow-sm border border-primary-200 dark:bg-gray-900 dark:border-primary-800"
                                                title="Currently selected"
                                            >
                                                <ChevronRight size={20} />
                                            </button>
                                        ) : (
                                            <button 
                                                onClick={() => onSelect(p.id)}
                                                className="size-10 flex items-center justify-center text-gray-400 hover:text-primary-600 hover:bg-white hover:shadow-sm rounded-lg transition-all dark:hover:bg-gray-800"
                                                title="Select profile"
                                            >
                                                <ExternalLink size={18} />
                                            </button>
                                        )}
                                        
                                        <div className="w-px h-6 bg-gray-200 mx-1 dark:bg-gray-700" />
                                        
                                        <button 
                                            onClick={() => handleEdit(p)}
                                            className="size-10 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-white hover:shadow-sm rounded-lg transition-all dark:hover:bg-gray-800"
                                            title="Edit profile"
                                        >
                                            <Edit2 size={18} />
                                        </button>
                                        <button 
                                            onClick={() => handleDelete(p.id)}
                                            className="size-10 flex items-center justify-center text-gray-400 hover:text-error-600 hover:bg-error-50 rounded-lg transition-all dark:hover:bg-error-900/20"
                                            title="Delete profile"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="p-4 bg-primary-50 dark:bg-primary-900/10 rounded-xl border border-primary-100 dark:border-primary-900/20 flex items-start gap-3">
                        <AlertCircle className="text-primary-600 dark:text-primary-400 shrink-0 mt-0.5" size={18} />
                        <div>
                            <p className="text-sm font-bold text-primary-900 dark:text-primary-300">Pro Tip</p>
                            <p className="text-xs text-primary-700 dark:text-primary-400 leading-relaxed">
                                You can manage separate configurations for your development and production servers by creating multiple profiles.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
