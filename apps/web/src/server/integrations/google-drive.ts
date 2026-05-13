import { google, type drive_v3, type docs_v1 } from 'googleapis';
import { env } from '@/env';

interface ServiceAccountJson {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
}

interface DriveClients {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
}

let _clients: DriveClients | null = null;

function loadClients(): DriveClients | null {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  if (_clients) return _clients;

  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccountJson;
  } catch {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    return null;
  }
  if (!parsed.client_email || !parsed.private_key) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON missing client_email or private_key');
    return null;
  }

  const auth = new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key.replace(/\\n/g, '\n'),
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/documents',
    ],
  });
  _clients = {
    drive: google.drive({ version: 'v3', auth }),
    docs: google.docs({ version: 'v1', auth }),
  };
  return _clients;
}

export function isGoogleDriveConfigured(): boolean {
  return loadClients() !== null;
}

export interface DriveSearchHit {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  owner: string | null;
}

export async function searchDrive(query: string, limit = 10): Promise<DriveSearchHit[]> {
  const clients = loadClients();
  if (!clients) return [];

  const escaped = query.replace(/'/g, "\\'").slice(0, 200);
  const q = `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false`;

  const res = await clients.drive.files.list({
    q,
    pageSize: Math.min(Math.max(limit, 1), 50),
    fields: 'files(id,name,mimeType,webViewLink,modifiedTime,owners(displayName))',
    orderBy: 'modifiedTime desc',
    corpora: 'allDrives',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  return (res.data.files ?? []).map((f) => ({
    id: f.id ?? '',
    name: f.name ?? 'Untitled',
    mimeType: f.mimeType ?? 'unknown',
    webViewLink: f.webViewLink ?? null,
    modifiedTime: f.modifiedTime ?? null,
    owner: f.owners?.[0]?.displayName ?? null,
  }));
}

function docElementsToText(elements: docs_v1.Schema$StructuralElement[] | undefined): string {
  if (!elements) return '';
  const parts: string[] = [];
  for (const el of elements) {
    if (el.paragraph?.elements) {
      const line = el.paragraph.elements
        .map((e) => e.textRun?.content ?? '')
        .join('');
      parts.push(line);
    } else if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          parts.push(docElementsToText(cell.content));
        }
      }
    }
  }
  return parts.join('').replace(/\n+/g, '\n');
}

export async function fetchDriveDocument(
  fileId: string,
): Promise<{ id: string; title: string; mimeType: string; body: string; webViewLink: string | null } | null> {
  const clients = loadClients();
  if (!clients) return null;

  const meta = await clients.drive.files.get({
    fileId,
    fields: 'id,name,mimeType,webViewLink',
    supportsAllDrives: true,
  });
  const mimeType = meta.data.mimeType ?? 'unknown';

  let body = '';
  if (mimeType === 'application/vnd.google-apps.document') {
    const doc = await clients.docs.documents.get({ documentId: fileId });
    body = docElementsToText(doc.data.body?.content);
  } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    const file = await clients.drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' },
    );
    body = String(file.data ?? '');
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    body = '[spreadsheet — open in Drive to view]';
  } else {
    body = `[binary file: ${mimeType} — open in Drive to view]`;
  }

  return {
    id: meta.data.id ?? fileId,
    title: meta.data.name ?? 'Untitled',
    mimeType,
    body: body.slice(0, 50_000),
    webViewLink: meta.data.webViewLink ?? null,
  };
}

export async function createDriveDocument(args: {
  title: string;
  body: string;
  folderId?: string;
}): Promise<{ id: string; webViewLink: string } | null> {
  const clients = loadClients();
  if (!clients) return null;

  const folderId = args.folderId ?? env.GOOGLE_DRIVE_DEFAULT_FOLDER_ID;

  const created = await clients.docs.documents.create({
    requestBody: { title: args.title.slice(0, 200) },
  });
  const documentId = created.data.documentId;
  if (!documentId) throw new Error('Drive: failed to create document');

  if (args.body) {
    await clients.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              text: args.body.slice(0, 100_000),
              location: { index: 1 },
            },
          },
        ],
      },
    });
  }

  if (folderId) {
    await clients.drive.files.update({
      fileId: documentId,
      addParents: folderId,
      supportsAllDrives: true,
      fields: 'id,parents',
    });
  }

  const meta = await clients.drive.files.get({
    fileId: documentId,
    fields: 'webViewLink',
    supportsAllDrives: true,
  });

  return {
    id: documentId,
    webViewLink: meta.data.webViewLink ?? `https://docs.google.com/document/d/${documentId}`,
  };
}

export async function appendToDriveDocument(documentId: string, body: string): Promise<boolean> {
  const clients = loadClients();
  if (!clients) return false;

  // Find end-of-document index.
  const doc = await clients.docs.documents.get({ documentId });
  const content = doc.data.body?.content ?? [];
  const last = content[content.length - 1];
  const endIndex = last?.endIndex ?? 1;

  await clients.docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            text: `\n${body.slice(0, 100_000)}`,
            location: { index: Math.max(endIndex - 1, 1) },
          },
        },
      ],
    },
  });
  return true;
}
