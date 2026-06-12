import React, { useMemo } from 'react';
import { FileCode, Search, ExternalLink } from 'lucide-react';
import { Table, TableCard } from '@/components/application/table/table';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { cx } from '@/utils/cx';
import { ROOT_SPAWNABLE_GROUP } from '@/utils/xml';

interface SpawnableTypesManagerProps {
    spawnableFilesByGroup: Record<string, string[]>;
    onClose: () => void;
    onViewCle?: (group: string) => void;
}

export function SpawnableTypesManager({ spawnableFilesByGroup, onClose, onViewCle }: SpawnableTypesManagerProps) {
    const [searchTerm, setSearchTerm] = React.useState('');

    const files = useMemo(() => {
        const result: { group: string; path: string; fileName: string; isRoot: boolean }[] = [];
        
        for (const [group, paths] of Object.entries(spawnableFilesByGroup)) {
            for (const path of paths) {
                const parts = path.split('/');
                const fileName = parts[parts.length - 1];
                const isRoot = group === ROOT_SPAWNABLE_GROUP;
                
                result.push({
                    group: isRoot ? 'Mission Root' : group,
                    path,
                    fileName,
                    isRoot
                });
            }
        }
        
        return result.filter(f => 
            f.group.toLowerCase().includes(searchTerm.toLowerCase()) || 
            f.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            f.path.toLowerCase().includes(searchTerm.toLowerCase())
        ).sort((a, b) => {
            if (a.isRoot) return -1;
            if (b.isRoot) return 1;
            return a.group.localeCompare(b.group);
        });
    }, [spawnableFilesByGroup, searchTerm]);

    return (
        <div className="flex flex-col h-full bg-primary overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-secondary bg-primary">
                <div>
                    <h1 className="text-display-sm font-semibold text-primary">Spawnable Types</h1>
                    <p className="text-md text-tertiary">Manage registered spawnable configuration files across CLE groups.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-6 bg-secondary/50">
                <TableCard>
                    <TableCard.Header 
                        title="Registered Files" 
                        badge={files.length}
                        contentTrailing={
                            <div className="w-80">
                                <Input 
                                    placeholder="Search groups or files..." 
                                    icon={Search}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        }
                    />
                    <Table aria-label="Spawnable types files">
                        <Table.Header className="bg-gray-50 dark:bg-gray-900/50">
                            <Table.Column isRowHeader>Group</Table.Column>
                            <Table.Column>Filename</Table.Column>
                            <Table.Column>Path</Table.Column>
                            <Table.Column className="w-0 text-center">Status</Table.Column>
                            <Table.Column className="w-0">Actions</Table.Column>
                        </Table.Header>
                        <Table.Body>
                            {files.map((file, idx) => (
                                <Table.Row key={`${file.group}-${file.path}-${idx}`} className="bg-primary hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                    <Table.Cell>
                                        <span className={cx("font-medium", file.isRoot ? "text-primary italic" : "text-primary")}>
                                            {file.group}
                                        </span>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div className="flex items-center gap-2">
                                            <FileCode className="size-4 text-tertiary" />
                                            <span className="text-secondary">{file.fileName}</span>
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <span className="text-tertiary text-xs font-mono">{file.path}</span>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div className="flex justify-center">
                                            <Badge color={file.isRoot ? "blue" : "gray"} size="sm" type="modern">
                                                {file.isRoot ? "Primary" : "Grouped"}
                                            </Badge>
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div className="flex justify-end">
                                            <Button 
                                                variant="tertiary" 
                                                size="sm" 
                                                icon={ExternalLink}
                                                onClick={() => onViewCle?.(file.isRoot ? '' : file.group)}
                                            >
                                                View in CLE
                                            </Button>
                                        </div>
                                    </Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table>
                    {files.length === 0 && (
                        <div className="p-12 text-center">
                            <p className="text-tertiary">No matching spawnable files found.</p>
                        </div>
                    )}
                </TableCard>
            </div>
        </div>
    );
}
