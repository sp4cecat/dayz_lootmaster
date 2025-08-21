import React from 'react';

/**
 * @param {{
 *  diff: {
 *    definitions: { categories: boolean, usageflags: boolean, valueflags: boolean, tags: boolean },
 *    files: Record<string, Record<string, { changed: boolean, added: number, removed: number, modified: number, changedCount: number }>>
 *  },
 *  onClose: () => void
 * }} props
 */
export default function StorageStatusModal({ diff, onClose }) {
  const defChanged = diff.definitions.categories || diff.definitions.usageflags || diff.definitions.valueflags || diff.definitions.tags;
  const groups = Object.keys(diff.files)
    .filter(g => Object.values(diff.files[g]).some(info => info.changed))
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Storage status">
      <div className="modal">
        <div className="modal-header">
          <h2>Storage differences</h2>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <p className="muted">
            Comparing current state with parsed files baseline.
          </p>

          <section>
            <h4>Definitions</h4>
            {defChanged ? (
              <ul className="bulleted">
                {diff.definitions.categories && <li>Categories changed</li>}
                {diff.definitions.usageflags && <li>Usage flags changed</li>}
                {diff.definitions.valueflags && <li>Value flags changed</li>}
                {diff.definitions.tags && <li>Tags changed</li>}
              </ul>
            ) : (
              <p className="muted">No changes</p>
            )}
          </section>

          <section>
            <h4>Types files</h4>
            {groups.length === 0 ? (
              <p className="muted">No types changes.</p>
            ) : (
              <div>
                {groups.map(g => {
                  const files = diff.files[g];
                  const fileKeys = Object.keys(files)
                    .filter(f => files[f].changed)
                    .sort((a, b) => a.localeCompare(b));
                  if (fileKeys.length === 0) return null;
                  return (
                    <div key={g} style={{ marginBottom: 10 }}>
                      <strong>{g}</strong>
                      <ul className="bulleted">
                        {fileKeys.map(f => {
                          const info = files[f];
                          return (
                            <li key={f}>
                              <code>{f}.xml</code>{' '}–{' '}
                              <strong>{info.changedCount}</strong> types changed
                              {' '}
                              <span className="muted">
                                (added: {info.added}, removed: {info.removed}, modified: {info.modified})
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
