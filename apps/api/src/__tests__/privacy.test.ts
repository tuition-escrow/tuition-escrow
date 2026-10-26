/**
 * Log-scanning test.
 *
 * Verifies that logs never emit student identifiers, salts, or student_refs
 * paired with identifying information.
 *
 * README section: "Privacy model" — "Ensure logs never contain identifiers,
 * salts, or student_refs paired with identifiers."
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LocalKmsAdapter } from '../../kms/kms';
import { StudentMappingService } from '../../services/studentMapping';
import { Pool } from 'pg';

const SENTINEL_IDENTIFIER = 'SENTINEL_STUDENT_ID_DO_NOT_LOG';

describe('Privacy: logs must not contain student identifiers or salts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prepareMapping does not log the student identifier', async () => {
    const loggedMessages: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      loggedMessages.push(String(chunk));
      return true;
    });

    const kms = new LocalKmsAdapter('test-wrapping-key-32-bytes-minimum!');
    const pool = {
      query: vi.fn((text: string) => {
        if (text.includes('INSERT INTO student_mappings')) {
          return { rows: [{ id: 'mapping-uuid-1' }] };
        }
        if (text.includes('INSERT INTO audit_log')) return { rows: [] };
        return { rows: [] };
      }),
    } as unknown as Pool;

    const service = new StudentMappingService(pool, kms, 'dev-key');
    await service.prepareMapping(SENTINEL_IDENTIFIER, 'user-1');

    vi.restoreAllMocks();
    const allLogs = loggedMessages.join('\n');
    expect(allLogs).not.toContain(SENTINEL_IDENTIFIER);
  });

  it('getMappingForSchool does not log the decrypted identifier', async () => {
    const loggedMessages: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      loggedMessages.push(String(chunk));
      return true;
    });

    const kms = new LocalKmsAdapter('test-wrapping-key-32-bytes-minimum!');
    const encryptedId = await kms.encrypt('dev-key', SENTINEL_IDENTIFIER);
    const encryptedSalt = await kms.encrypt('dev-key', 'some-salt-value');

    const pool = {
      query: vi.fn((text: string) => {
        if (text.includes('FROM student_mappings')) {
          return {
            rows: [{
              id: 'mapping-1',
              encrypted_student_identifier: encryptedId,
              encrypted_salt: encryptedSalt,
              key_id: 'dev-key',
              deleted_at: null,
            }],
          };
        }
        if (text.includes('INSERT INTO audit_log')) return { rows: [] };
        return { rows: [] };
      }),
    } as unknown as Pool;

    const service = new StudentMappingService(pool, kms, 'dev-key');
    const result = await service.getMappingForSchool(42, 'school-admin-1');

    vi.restoreAllMocks();

    // Value returned correctly…
    expect(result.studentIdentifier).toBe(SENTINEL_IDENTIFIER);

    // …but never appears in logs
    const allLogs = loggedMessages.join('\n');
    expect(allLogs).not.toContain(SENTINEL_IDENTIFIER);
  });

  it('deleteMapping does not log identifier or salt', async () => {
    const loggedMessages: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      loggedMessages.push(String(chunk));
      return true;
    });

    const kms = new LocalKmsAdapter('test-wrapping-key-32-bytes-minimum!');
    const pool = {
      query: vi.fn((text: string) => {
        if (text.includes('UPDATE student_mappings')) return { rows: [] };
        if (text.includes('INSERT INTO audit_log')) return { rows: [] };
        return { rows: [] };
      }),
    } as unknown as Pool;

    const service = new StudentMappingService(pool, kms, 'dev-key');
    await service.deleteMapping('mapping-1', 'admin-1');

    vi.restoreAllMocks();
    const allLogs = loggedMessages.join('\n');
    expect(allLogs).not.toContain(SENTINEL_IDENTIFIER);
    expect(allLogs).not.toContain('salt');
  });
});
