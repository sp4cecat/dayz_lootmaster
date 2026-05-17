import React, { useMemo, useState } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { Plus, Trash2, AlertCircle } from 'lucide-react';

interface UnknownsSets {
  usage: Set<string>;
  value: Set<string>;
  tag: Set<string>;
  category: Set<string>;
}

interface UnknownEntriesModalProps {
  unknowns: {
    hasAny: boolean;
    sets: UnknownsSets;
  };
  onApply: (opts: { add: { usage: string[]; value: string[]; tag: string[]; category: string[] }; remove: boolean }) => void;
  onClose: () => void;
}

export default function UnknownEntriesModal({ unknowns, onApply, onClose }: UnknownEntriesModalProps) {
  const [state, setState] = useState({
    addUsage: new Set<string>(),
    addValue: new Set<string>(),
    addTag: new Set<string>(),
    addCategory: new Set<string>(),
  });

  const toggleSet = (key: keyof typeof state, val: string) => {
    setState(s => {
      const ns = new Set(s[key]);
      if (ns.has(val)) ns.delete(val);
      else ns.add(val);
      return { ...s, [key]: ns };
    });
  };

  const selectionCount = useMemo(() =>
    state.addUsage.size + state.addValue.size + state.addTag.size + state.addCategory.size
  , [state.addUsage, state.addValue, state.addTag, state.addCategory]);

  const onAddSelected = () => {
    onApply({
      add: {
        usage: Array.from(state.addUsage),
        value: Array.from(state.addValue),
        tag: Array.from(state.addTag),
        category: Array.from(state.addCategory),
      },
      remove: false
    });
  };

  const onRemoveSelected = () => {
    onApply({
      add: { usage: [], value: [], tag: [], category: [] },
      remove: true
    });
  };

  const footer = (
    <>
      <Button variant="secondary-gray" onClick={onClose}>Cancel</Button>
      <Button 
        variant="secondary-gray" 
        onClick={onRemoveSelected} 
        disabled={selectionCount === 0}
        title="Remove selected entries from affected types"
      >
        <Trash2 size={18} className="mr-2" /> Remove from Types
      </Button>
      <Button 
        onClick={onAddSelected} 
        disabled={selectionCount === 0}
        title="Add selected entries to definitions"
      >
        <Plus size={18} className="mr-2" /> Add to Definitions
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Resolve Unknown Entries"
      description="Select unknown entries and choose how to resolve them."
      footer={footer}
      icon={AlertCircle}
      iconVariant="warning"
    >
      <div className="space-y-6">
        <ResolveSection
          title="Categories"
          items={Array.from(unknowns.sets.category)}
          selected={state.addCategory}
          onToggle={(v) => toggleSet('addCategory', v)}
        />
        <ResolveSection
          title="Usage flags"
          items={Array.from(unknowns.sets.usage)}
          selected={state.addUsage}
          onToggle={(v) => toggleSet('addUsage', v)}
        />
        <ResolveSection
          title="Value flags"
          items={Array.from(unknowns.sets.value)}
          selected={state.addValue}
          onToggle={(v) => toggleSet('addValue', v)}
        />
        <ResolveSection
          title="Tags"
          items={Array.from(unknowns.sets.tag)}
          selected={state.addTag}
          onToggle={(v) => toggleSet('addTag', v)}
        />
      </div>
    </Modal>
  );
}

interface ResolveSectionProps {
  title: string;
  items: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}

function ResolveSection({ title, items, selected, onToggle }: ResolveSectionProps) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h4>
      <div className="flex flex-wrap gap-2">
        {items.map(it => (
          <Badge
            key={it}
            color={selected.has(it) ? "brand" : "gray"}
            size="sm"
            className="cursor-pointer py-1.5 px-3"
            onClick={() => onToggle(it)}
          >
            {it}
          </Badge>
        ))}
      </div>
    </div>
  );
}
