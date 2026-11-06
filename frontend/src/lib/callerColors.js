const CALLER_PALETTE = [
  { bg: '#dbeafe', border: '#2563eb', text: '#1e3a8a', soft: '#3b82f6' },
  { bg: '#dcfce7', border: '#16a34a', text: '#14532d', soft: '#22c55e' },
  { bg: '#ffedd5', border: '#ea580c', text: '#9a3412', soft: '#f97316' },
  { bg: '#fce7f3', border: '#db2777', text: '#9d174d', soft: '#ec4899' },
  { bg: '#ede9fe', border: '#7c3aed', text: '#5b21b6', soft: '#8b5cf6' },
  { bg: '#ccfbf1', border: '#0d9488', text: '#115e59', soft: '#14b8a6' },
  { bg: '#fee2e2', border: '#dc2626', text: '#991b1b', soft: '#ef4444' },
  { bg: '#e0e7ff', border: '#4f46e5', text: '#3730a3', soft: '#6366f1' },
  { bg: '#fef3c7', border: '#d97706', text: '#92400e', soft: '#f59e0b' },
  { bg: '#e2e8f0', border: '#475569', text: '#1e293b', soft: '#64748b' },
];

function hashId(value) {
  const text = String(value || 'unknown');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getCallerColor(callerId) {
  const index = hashId(callerId) % CALLER_PALETTE.length;
  return CALLER_PALETTE[index];
}
