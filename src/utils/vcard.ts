/**
 * Extracts contact information from business card OCR text and generates a downloadable/shareable .vcf contact file.
 */
export interface ParsedContact {
  fullName: string;
  phone: string;
  email: string;
  organization: string;
  title: string;
  website: string;
}

export function parseBusinessCardText(ocrText: string, fallbackName = 'New Contact'): ParsedContact {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Email regex
  const emailMatch = ocrText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : '';

  // Phone regex (international and local formats)
  const phoneMatch = ocrText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/);
  const phone = phoneMatch ? phoneMatch[0].trim() : '';

  // Website regex
  const urlMatch = ocrText.match(/(?:https?:\/\/|www\.)[^\s/$.?#].[^\s]*/i);
  const website = urlMatch ? (urlMatch[0].startsWith('http') ? urlMatch[0] : 'https://' + urlMatch[0]) : '';

  // Extract candidate name: look for line with 2-3 words (no numbers, no @, not a URL)
  let candidateName = '';
  let candidateOrg = '';
  let candidateTitle = '';

  for (const line of lines) {
    if (line.includes('@') || line.match(/\d{4,}/) || line.toLowerCase().includes('http') || line.toLowerCase().includes('www')) {
      continue;
    }
    const words = line.split(/\s+/);
    if (!candidateName && words.length >= 2 && words.length <= 4 && /^[A-Za-z\s.'-]+$/.test(line)) {
      candidateName = line;
    } else if (candidateName && !candidateTitle && words.length <= 4) {
      // Common titles: Manager, Director, Engineer, Consultant, CEO, Founder, etc.
      if (/(manager|director|officer|engineer|lead|founder|ceo|consultant|developer|designer|partner|doctor|dr\.)/i.test(line)) {
        candidateTitle = line;
      } else if (!candidateOrg) {
        candidateOrg = line;
      }
    } else if (!candidateOrg && words.length <= 5) {
      candidateOrg = line;
    }
  }

  return {
    fullName: candidateName || fallbackName,
    phone,
    email,
    organization: candidateOrg,
    title: candidateTitle,
    website,
  };
}

export function generateVCardString(contact: ParsedContact): string {
  const nameParts = contact.fullName.split(/\s+/);
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
  const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : contact.fullName;

  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${contact.fullName}`,
    `N:${lastName};${firstName};;;`,
    contact.organization ? `ORG:${contact.organization}` : '',
    contact.title ? `TITLE:${contact.title}` : '',
    contact.phone ? `TEL;TYPE=CELL,VOICE:${contact.phone}` : '',
    contact.email ? `EMAIL;TYPE=INTERNET,PREF:${contact.email}` : '',
    contact.website ? `URL:${contact.website}` : '',
    'NOTE:Scanned and extracted with Phantom Scanner',
    'END:VCARD',
  ]
    .filter(Boolean)
    .join('\r\n');
}

export async function shareOrDownloadVCard(contact: ParsedContact): Promise<void> {
  const vcfContent = generateVCardString(contact);
  const fileName = `${contact.fullName.replace(/[/\\?%*:|"<>]/g, '_') || 'Contact'}.vcf`;
  const file = new File([vcfContent], fileName, { type: 'text/vcard' });

  // Web Share API
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: contact.fullName,
        text: `Contact: ${contact.fullName}`,
      });
      return;
    } catch (e: unknown) {
      if ((e as Error)?.name === 'AbortError') return;
    }
  }

  // Fallback: Download file
  const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
