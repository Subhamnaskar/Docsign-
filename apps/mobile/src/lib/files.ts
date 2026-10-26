import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { PDFDocument } from 'pdf-lib';
import { API_URL, api, ApiError, authHeaders } from './api';

export interface LocalFile {
  uri: string;
  name: string;
  size?: number;
}

/** Uploads go through the website's server, which accepts requests up to about 4.5 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Lets the user choose a PDF from the phone, Drive, iCloud and so on. */
export async function pickPdf(): Promise<LocalFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
  if (res.canceled || !res.assets.length) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name.toLowerCase().endsWith('.pdf') ? a.name : `${a.name}.pdf`, size: a.size };
}

/** Takes a photo of one paper page, shrunk to a size that keeps multi-page scans uploadable. */
export async function scanPage(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new ApiError('Allow camera access in Settings to scan documents.', 0);
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (shot.canceled || !shot.assets.length) return null;
  const image = await ImageManipulator.manipulate(shot.assets[0].uri).resize({ width: 1400 }).renderAsync();
  const page = await image.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  return page.base64 ?? null;
}

/** Turns scanned pages (JPEG, base64) into one PDF in the app's cache. */
export async function pagesToPdf(pages: string[], title: string): Promise<LocalFile> {
  const pdf = await PDFDocument.create();
  for (const b64 of pages) {
    const img = await pdf.embedJpg(b64);
    // A4 width, height following the photo
    const width = 595;
    const height = (img.height / img.width) * width;
    pdf.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
  }
  const bytes = await pdf.save();
  const file = new File(Paths.cache, `${safeName(title)}.pdf`);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return { uri: file.uri, name: `${safeName(title)}.pdf`, size: bytes.length };
}

/** Adds a PDF to a draft agreement. */
export async function uploadDocument(envelopeId: string, file: LocalFile) {
  if (file.size && file.size > MAX_UPLOAD_BYTES) throw new ApiError('This file is larger than 4 MB. Choose a smaller PDF.', 413);
  const form = new FormData();
  // React Native reads the file from its uri
  form.append('file', { uri: file.uri, name: file.name, type: 'application/pdf' } as unknown as Blob);
  return api(`/envelopes/${envelopeId}/documents`, { form });
}

/** Downloads a PDF from the API and opens the share sheet (save to Files, WhatsApp, email…). */
export async function sharePdf(path: string, filename: string) {
  const dir = new Directory(Paths.cache, 'shared');
  dir.create({ idempotent: true });
  const target = new File(dir, safeName(filename.replace(/\.pdf$/i, '')) + '.pdf');
  if (target.exists) target.delete();
  const task = File.createDownloadTask(`${API_URL}/api/v1${path}`, target, { headers: authHeaders() });
  const file = await task.downloadAsync();
  if (!file) throw new ApiError('The download did not finish.', 0);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: filename });
}

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'document';
