import React from 'react';
import {
  Swords,
  Server,
  BookOpen,
  CheckSquare,
  Users,
  Cpu,
  Database,
  Globe,
  Briefcase,
  FlaskConical,
  ShieldAlert,
  Sparkles,
  Layers,
  type LucideProps
} from 'lucide-react';

export const ICON_OPTIONS = [
  'Swords',
  'Server',
  'BookOpen',
  'CheckSquare',
  'Users',
  'Cpu',
  'Database',
  'Globe',
  'Briefcase',
  'FlaskConical',
  'ShieldAlert',
  'Sparkles'
] as const;

const iconMap: Record<string, React.ComponentType<LucideProps>> = {
  Swords,
  Server,
  BookOpen,
  CheckSquare,
  Users,
  Cpu,
  Database,
  Globe,
  Briefcase,
  FlaskConical,
  ShieldAlert,
  Sparkles,
  Layers
};

export function BlueprintIcon({
  name,
  className = 'w-4 h-4'
}: {
  name?: string;
  className?: string;
}) {
  const IconComp = (name && iconMap[name]) || Sparkles;
  return <IconComp className={className} />;
}
