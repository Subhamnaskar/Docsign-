import type { Me } from './types';

const OFFICE = '.doc,.docx,.odt,.rtf,.txt,.xls,.xlsx,.ods,.ppt,.pptx,.odp';

/**
 * What document uploads accept on this server: office files only when it can
 * convert them, and its size limit (smaller on Vercel, which caps requests).
 */
export function uploadRules(me: Me | null) {
  const office = me?.features?.officeFiles ?? false;
  const limitMb = me?.features?.uploadLimitMb ?? 25;
  return {
    accept: office ? `.pdf,${OFFICE}` : '.pdf,application/pdf',
    hint: `${office ? 'PDF, Word, Excel or PowerPoint' : 'PDF'}, up to ${limitMb} MB`,
    /** A reason the file can't be uploaded, checked before sending it */
    problem(file: File): string | null {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      if (ext !== 'pdf' && !office) return `${file.name}: upload a PDF. Word, Excel and PowerPoint files aren't available yet.`;
      if (file.size > limitMb * 1024 * 1024) return `${file.name} is larger than ${limitMb} MB.`;
      return null;
    },
  };
}
