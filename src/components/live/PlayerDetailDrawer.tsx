import { Modal } from '../base/modal/modal';
import { User } from 'lucide-react';
import { useCfToolsPlayerStats } from '@/hooks/useCfToolsPlayerStats';
import PlayerStatsBlock from './PlayerStatsBlock';

interface PlayerDetailDrawerProps {
  cftoolsId: string;
  playerName?: string;
  selectedProfileId?: string;
  onClose: () => void;
}

/**
 * Per-player stats from the CF Tools v2 player endpoint, in a modal. The fetch
 * and the rows live in `useCfToolsPlayerStats` / `PlayerStatsBlock`, which the
 * live map's player card shares.
 */
export default function PlayerDetailDrawer({ cftoolsId, playerName, selectedProfileId, onClose }: PlayerDetailDrawerProps) {
  const stats = useCfToolsPlayerStats(cftoolsId, selectedProfileId);

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={playerName || 'Player details'}
      description={cftoolsId}
      icon={User}
      maxWidth="max-w-md"
    >
      <PlayerStatsBlock {...stats} />
    </Modal>
  );
}
