import React, { useMemo } from 'react';
import { FileCode, Search, ExternalLink } from 'lucide-react';
import { Table, TableCard } from '@/components/application/table/table';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { cx } from '@/utils/cx';
import { ROOT_SPAWNABLE_GROUP } from '@/utils/xml';
import { formatModName } from '@/utils/format';

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
                    group: isRoot ? ROOT_SPAWNABLE_GROUP : group,
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
        <div className="flex flex-col h-full bg-white dark:bg-gray-950 overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950">
                <div>
                    <h1 className="text-display-sm font-semibold text-gray-900 dark:text-white">Spawnable Types</h1>
                    <p className="text-md text-gray-600 dark:text-gray-400">Manage registered spawnable configuration files across CLE groups.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto p-6 bg-gray-50 dark:bg-gray-900/50">
                <TableCard>
                    <TableCard.Header 
                        title="Registered Files" 
                        badge={files.length}
                        description="View and manage spawnabletypes.xml files registered in your mission."
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
                        <Table.Header>
                            <Table.Column isRowHeader>Group</Table.Column>
                            <Table.Column>Filename</Table.Column>
                            <Table.Column>Path</Table.Column>
                            <Table.Column className="w-0 text-center">Status</Table.Column>
                            <Table.Column className="w-0">Actions</Table.Column>
                        </Table.Header>
                        <Table.Body>
                            {files.map((file, idx) => (
                                <Table.Row key={`${file.group}-${file.path}-${idx}`}>
                                    <Table.Cell>
                                        <span className={cx("font-medium", file.isRoot ? "text-gray-900 dark:text-white italic" : "text-gray-900 dark:text-white")}>
                                            {formatModName(file.group)}
                                        </span>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div className="flex items-center gap-2">
                                            <FileCode className="size-4 text-gray-400" />
                                            <span className="text-gray-700 dark:text-gray-300">{file.fileName}</span>
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <span className="text-gray-500 dark:text-gray-400 text-xs font-mono">{file.path}</span>
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
                            <p className="text-gray-500 dark:text-gray-400">No matching spawnable files found.</p>
                        </div>
                    )}
                </TableCard>
            </div>
        </div>
    );
}
