import { useEffect, useMemo, useState } from 'react';
import { Modal } from './base/modal/modal';
import { Button } from './base/button/button';
import { Input } from './base/input/input';
import { Select } from './base/select/select';
import { ShoppingBag01, Trash01, Plus, Save01, XClose } from '@untitledui/icons';
import { apiFetch } from '@/utils/api';

const ENTITY_CLASSES = [
  'ExpansionTraderAIMirek',
  'ExpansionTraderAIDenis',
  'ExpansionTraderAIBoris',
  'ExpansionTraderAICyril',
  'ExpansionTraderAIElias',
  'ExpansionTraderAIFrancis',
  'ExpansionTraderAIGuo',
  'ExpansionTraderAIHassan',
  'ExpansionTraderAIIndar',
  'ExpansionTraderAIJose',
  'ExpansionTraderAIKaito',
  'ExpansionTraderAILewis',
  'ExpansionTraderAIManua',
  'ExpansionTraderAINiki',
  'ExpansionTraderAIOliver',
  'ExpansionTraderAIPeter',
  'ExpansionTraderAIQuinn',
  'ExpansionTraderAIRolf',
  'ExpansionTraderAISeth',
  'ExpansionTraderAITaiki',
  'ExpansionTraderAILinda',
  'ExpansionTraderAIMaria',
  'ExpansionTraderAIFrida',
  'ExpansionTraderAIGabi',
  'ExpansionTraderAIHelga',
  'ExpansionTraderAIIrena',
  'ExpansionTraderAIJudy',
  'ExpansionTraderAIKeiko',
  'ExpansionTraderAIEva',
  'ExpansionTraderAINaomi',
  'ExpansionTraderAIBaty',
];

interface Category {
  name: string;
  flag: number;
}

interface TraderEditorModalProps {
  onClose: () => void;
  selectedProfileId: string;
  isPanel?: boolean;
}

function useEditorID() {
  try {
    return localStorage.getItem('dayz-editor:editorID:selected') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseCategories(arr: any[]): Category[] {
  const out: Category[] = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    if (typeof v !== 'string') continue;
    const idx = v.lastIndexOf(':');
    const rawName = idx >= 0 ? v.slice(0, idx) : v;
    const rawFlag = idx >= 0 ? v.slice(idx + 1) : '';
    const name = String(rawName).trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    const f = Number(rawFlag);
    const flag = Number.isFinite(f) ? f : 1;
    seen.add(key);
    out.push({ name, flag });
  }
  return out;
}

function dedupeCategoryList(list: Category[]): Category[] {
  const out: Category[] = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const name = String(item && item.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const flagNum = Number(item && item.flag);
    out.push({ name, flag: Number.isFinite(flagNum) ? flagNum : 1 });
  }
  return out;
}

function serializeCategories(list: Category[]) {
  return list.map(({ name, flag }) => `${name}:${Number(flag) | 0}`);
}

export default function TraderEditorModal({ onClose, selectedProfileId, isPanel = false }: TraderEditorModalProps) {
  const editorID = useEditorID();

  const [traders, setTraders] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<string[]>([]);

  const [selectedTrader, setSelectedTrader] = useState('');

  const [className, setClassName] = useState(ENTITY_CLASSES[0]);
  const [traderFileName, setTraderFileName] = useState('');
  const [position, setPosition] = useState([0, 0, 0]);
  const [orientation, setOrientation] = useState([0, 0, 0]);
  const [attachments, setAttachments] = useState('');

  const [profileJson, setProfileJson] = useState<any>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [marketCategories, setMarketCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [tRes, pRes, mRes] = await Promise.all([
          apiFetch('/api/traders', { profileId: selectedProfileId }),
          apiFetch('/api/trader-profiles', { profileId: selectedProfileId }),
          apiFetch('/api/market/categories', { profileId: selectedProfileId }),
        ]);
        const tJson = await tRes.json().catch(() => ({ traders: [] }));
        const pJson = await pRes.json().catch(() => ({ profiles: [] }));
        const mJson = await mRes.json().catch(() => ({ categories: [] }));
        setTraders(Array.isArray(tJson.traders) ? tJson.traders : []);
        setProfiles(Array.isArray(pJson.profiles) ? pJson.profiles : []);
        setMarketCategories(Array.isArray(mJson.categories) ? mJson.categories : []);
        if (Array.isArray(tJson.traders) && tJson.traders.length > 0) {
          setSelectedTrader(tJson.traders[0]);
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [selectedProfileId]);

  useEffect(() => {
    if (!selectedTrader) return;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/traders/${encodeURIComponent(selectedTrader)}`, {
          profileId: selectedProfileId
        });
        if (!res.ok) throw new Error(`Failed to load trader ${selectedTrader}`);
        const json = await res.json();
        setClassName(json.className || ENTITY_CLASSES[0]);
        setTraderFileName(json.traderFileName || '');
        setPosition(Array.isArray(json.position) ? json.position : [0, 0, 0]);
        setOrientation(Array.isArray(json.orientation) ? json.orientation : [0, 0, 0]);
        setAttachments(Array.isArray(json.gear) ? json.gear.join(',') : '');
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [selectedTrader, selectedProfileId]);

  useEffect(() => {
    if (!traderFileName) {
      setProfileJson(null);
      setCategories([]);
      return;
    }
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await apiFetch(`/api/trader-profile/${encodeURIComponent(traderFileName)}`, {
          profileId: selectedProfileId
        });
        if (!res.ok) throw new Error(`Failed to load profile ${traderFileName}`);
        const json = await res.json();
        setProfileJson(json);
        setCategories(parseCategories(json.Categories));
      } catch (e) {
        setError(String(e));
        setProfileJson(null);
        setCategories([]);
      } finally {
        setBusy(false);
      }
    })();
  }, [traderFileName, selectedProfileId]);

  const setAllFlags = (flag: number) => {
    setCategories(prev => prev.map(c => ({ ...c, flag })));
  };

  const onDeleteCategory = (name: string) => {
    const ok = window.confirm(`Remove category '${name}' from this trader?`);
    if (!ok) return;
    setCategories(prev => prev.filter(c => c.name !== name));
  };

  const onSave = async () => {
    try {
      setBusy(true);
      setError(null);
      setNotice(null);
      const payloadMap = {
        className,
        traderFileName,
        position: position.map(Number),
        orientation: orientation.map(Number),
        gear: attachments.split(',').map(s => s.trim()).filter(Boolean),
      };
      const mapRes = await apiFetch(`/api/traders/${encodeURIComponent(selectedTrader)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Editor-ID': editorID || 'unknown'
        },
        profileId: selectedProfileId,
        body: JSON.stringify(payloadMap),
      });
      if (!mapRes.ok) {
        const msg = await mapRes.text().catch(() => '');
        throw new Error(`Save trader map failed (${mapRes.status}) ${msg}`);
      }
      if (profileJson) {
        const deduped = dedupeCategoryList(categories);
        const updated = { ...profileJson, Categories: serializeCategories(deduped) };
        const profRes = await apiFetch(`/api/trader-profile/${encodeURIComponent(traderFileName)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Editor-ID': editorID || 'unknown'
          },
          profileId: selectedProfileId,
          body: JSON.stringify(updated),
        });
        if (!profRes.ok) {
          const msg = await profRes.text().catch(() => '');
          throw new Error(`Save trader profile failed (${profRes.status}) ${msg}`);
        }
      }
      setNotice('Saved trader entity and profile.');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const attachmentsList = useMemo(() => attachments.split(',').map(s => s.trim()).filter(Boolean), [attachments]);

  const entityClassOptions = useMemo(() => {
    const base = [...ENTITY_CLASSES];
    if (className && !base.includes(className)) {
      return [className, ...base];
    }
    return base;
  }, [className]);

  const addableCategories = useMemo(() => {
    const existing = new Set((categories || []).map(c => String(c.name).toLowerCase()));
    return (marketCategories || [])
      .filter((n) => {
        const name = String(n || '').trim();
        if (!name) return false;
        return !existing.has(name.toLowerCase());
      })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [marketCategories, categories]);

  useEffect(() => {
    if (!newCategory && addableCategories.length > 0) {
      setNewCategory(addableCategories[0]);
    }
    if (newCategory && addableCategories.indexOf(newCategory) === -1) {
      setNewCategory(addableCategories[0] || '');
    }
  }, [addableCategories, newCategory]);

  const onAddCategory = () => {
    const name = (newCategory || '').trim();
    if (!name) return;
    const exists = categories.some(c => String(c.name).toLowerCase() === name.toLowerCase());
    if (exists) return;
    setCategories(prev => [...prev, { name, flag: 1 }]);
    setNewCategory('');
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Trader Editor"
      description="Configure trader positions, appearances, and categories."
      icon={ShoppingBag01}
      inline={isPanel}
      maxWidth="max-w-5xl"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onSave} disabled={busy || !selectedTrader || !traderFileName} icon={Save01}>
            {busy ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Selection Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Select 
            label="Trader File (.map)" 
            value={selectedTrader} 
            onChange={e => setSelectedTrader(e.target.value)}
            options={traders.map(t => ({ label: `${t}.map`, value: t }))}
          />
          <Select 
            label="Entity Class" 
            value={className} 
            onChange={e => setClassName(e.target.value)}
            options={entityClassOptions.map(c => ({ label: c, value: c }))}
          />
          <Select 
            label="Trader Profile" 
            value={traderFileName} 
            onChange={e => setTraderFileName(e.target.value)}
            options={[
              { label: 'Select profile...', value: '' },
              ...profiles.map(p => ({ label: p, value: p }))
            ]}
          />
        </div>

        {/* Position & Orientation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Position (X, Y, Z)</label>
            <div className="flex gap-2">
              {['X', 'Y', 'Z'].map((label, idx) => (
                <Input
                  key={label}
                  type="number"
                  step="any"
                  value={position[idx]}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setPosition(prev => prev.map((p, i) => i === idx ? v : p));
                  }}
                  aria-label={`Position ${label}`}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Orientation (X, Y, Z)</label>
            <div className="flex gap-2">
              {['X', 'Y', 'Z'].map((label, idx) => (
                <Input
                  key={label}
                  type="number"
                  step="any"
                  value={orientation[idx]}
                  onChange={e => {
                    const v = Number(e.target.value);
                    setOrientation(prev => prev.map((p, i) => i === idx ? v : p));
                  }}
                  aria-label={`Orientation ${label}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Attachments */}
        <Input 
          label="Attachments (comma separated)" 
          placeholder="Jeans_Blue,Shirt_GreenCheck,..."
          value={attachments}
          onChange={e => setAttachments(e.target.value)}
          hint={attachmentsList.length > 0 ? `Items: ${attachmentsList.join(', ')}` : 'No attachments configured.'}
        />

        {/* Categories Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-md font-semibold text-gray-900 dark:text-white">Categories</h4>
            <span className="text-xs text-gray-500">
              0=Buy, 1=Both, 2=Sell, 3=Hidden
            </span>
          </div>

          {!profileJson ? (
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-8 text-center text-sm text-gray-500">
              Select a trader profile to view and edit categories.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-left border-collapse">
                  <thead className="bg-gray-50 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Category Name</th>
                      {[0,1,2,3].map(flag => (
                        <th key={flag} className="px-2 py-3 text-center w-16">
                          <button 
                            type="button" 
                            onClick={() => setAllFlags(flag)}
                            className="text-xs font-bold text-primary-600 hover:text-primary-700 transition-colors uppercase"
                            title={`Set all to ${flag}`}
                          >
                            All {flag}
                          </button>
                        </th>
                      ))}
                      <th className="w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-950">
                    {categories.map(cat => (
                      <tr key={cat.name} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{cat.name}</td>
                        {[0,1,2,3].map(flag => (
                          <td key={flag} className="px-2 py-3 text-center">
                            <input 
                              type="radio" 
                              name={`flag-${cat.name}`}
                              checked={cat.flag === flag}
                              onChange={() => setCategories(prev => prev.map(c => c.name === cat.name ? { ...c, flag } : c))}
                              className="size-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-700 dark:bg-gray-800"
                            />
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right">
                          <button 
                            onClick={() => onDeleteCategory(cat.name)}
                            className="text-gray-400 hover:text-error-600 transition-colors p-1"
                          >
                            <Trash01 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-end gap-3 bg-gray-50 dark:bg-gray-900/50 p-4 rounded-xl border border-gray-200 dark:border-gray-800">
                <Select 
                  label="Add Category" 
                  value={newCategory} 
                  onChange={e => setNewCategory(e.target.value)}
                  disabled={busy || addableCategories.length === 0}
                  options={addableCategories.map(n => ({ label: n, value: n }))}
                  className="max-w-md"
                />
                <Button 
                  onClick={onAddCategory} 
                  disabled={busy || !newCategory || addableCategories.length === 0}
                  icon={Plus}
                >
                  Add
                </Button>
                {addableCategories.length === 0 && (
                  <span className="text-xs text-gray-500 mb-2.5">All categories added.</span>
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="p-3 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700 flex items-center gap-2 dark:bg-error-900/20 dark:border-error-800 dark:text-error-400">
            <XClose size={18} />
            {error}
          </div>
        )}
        
        {notice && (
          <div className="p-3 bg-primary-50 border border-primary-200 rounded-lg text-sm text-primary-700 flex items-center justify-between dark:bg-primary-900/20 dark:border-primary-800 dark:text-primary-400">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} className="text-xs font-bold uppercase hover:underline">Dismiss</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
