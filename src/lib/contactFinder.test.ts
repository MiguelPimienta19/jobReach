import { describe, it, expect } from 'vitest';
import { parseResult, classifyTitle, isCurrentEmployee, rankCandidates } from './contactFinder.js';
import type { RoleType, Contact } from '../types.js';
import type { UserProfile } from './profile.js';

// ============================================================================
// Local Test Interfaces
// ============================================================================

// Mirror of the (unexported) shapes in the frozen contract so fixtures stay
// typed without reaching into contactFinder internals.
interface SerperOrganicResult {
  title: string;
  link: string;
  snippet: string;
}

interface ParsedCandidate {
  name: string;
  title: string;
  company: string;
  linkedinUrl: string;
}

interface RankInput {
  candidate: ParsedCandidate;
  roleType: RoleType;
}

// ============================================================================
// Fixtures
// ============================================================================

// A fully-populated profile so the alumni heuristic has a school to match on.
const PROFILE: UserProfile = {
  name: 'Miguel Pimienta',
  school: 'University of Oregon',
  schoolShort: 'UO',
  gradMonth: 'June 2026',
};

// --- SerperOrganicResult fixtures (realistic Google SERP shapes) ---

const CLEAN_THREE_PART: SerperOrganicResult = {
  title: 'Jane Doe - University Recruiter - Acme Corp | LinkedIn',
  link: 'https://www.linkedin.com/in/janedoe?trk=x',
  snippet: 'University Recruiter at Acme Corp. Eugene, Oregon, United States.',
};

const CLEAN_TWO_PART: SerperOrganicResult = {
  title: 'John Smith - Senior Recruiter | LinkedIn',
  link: 'https://www.linkedin.com/in/johnsmith',
  snippet: 'Senior Recruiter. San Francisco Bay Area.',
};

const FOUR_PART: SerperOrganicResult = {
  title: 'Sarah Lee - Senior Technical - University Recruiter - Acme Corp | LinkedIn',
  link: 'https://www.linkedin.com/in/sarahlee/',
  snippet: 'Senior Technical University Recruiter at Acme Corp.',
};

const THIN_TITLE_RICH_SNIPPET: SerperOrganicResult = {
  title: 'Jane Doe | LinkedIn',
  link: 'https://www.linkedin.com/in/janedoe2',
  snippet: 'Jane Doe. University Recruiter at Acme Corp. Eugene, Oregon...',
};

const THIN_TITLE_JUNK_SNIPPET: SerperOrganicResult = {
  title: 'Jane Doe | LinkedIn',
  link: 'https://www.linkedin.com/in/janedoe3',
  snippet: "View Jane Doe's profile on LinkedIn, the world's largest professional community.",
};

const COMPANY_LINK: SerperOrganicResult = {
  title: 'Acme Corp | LinkedIn',
  link: 'https://www.linkedin.com/company/acme',
  snippet: 'Acme Corp. Software. 1,001-5,000 employees.',
};

const NON_LINKEDIN_LINK: SerperOrganicResult = {
  title: 'Jane Doe - University Recruiter - Acme Corp',
  link: 'https://example.com/team/janedoe',
  snippet: 'University Recruiter at Acme Corp.',
};

// KNOWN LIMITATION: localized SERP titles use en-dash / non-breaking separators
// and localized role words ("Recruiterin"). The frozen parseResult spec only
// guarantees the ASCII " - " hyphen separator, so this is tracked as a todo
// rather than forced to pass.
const LOCALIZED_EN_DASH: SerperOrganicResult = {
  title: 'Jane Doe – Recruiterin – Acme GmbH | LinkedIn',
  link: 'https://de.linkedin.com/in/janedoe-de',
  snippet: 'Recruiterin bei Acme GmbH. München, Bayern, Deutschland.',
};

// --- ParsedCandidate factory (for classify / current-employee / rank) ---

function candidate(overrides: Partial<ParsedCandidate> = {}): ParsedCandidate {
  return {
    name: 'Test Person',
    title: 'Recruiter',
    company: 'Acme Corp',
    linkedinUrl: 'https://www.linkedin.com/in/testperson',
    ...overrides,
  };
}

function rankItem(roleType: RoleType, name: string): RankInput {
  return {
    candidate: candidate({ name: name }),
    roleType: roleType,
  };
}

// ============================================================================
// parseResult
// ============================================================================

describe('parseResult', () => {
  it('parses a clean 3-part title and strips URL query params', () => {
    const parsed = parseResult(CLEAN_THREE_PART);

    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({
      name: 'Jane Doe',
      title: 'University Recruiter',
      company: 'Acme Corp',
      linkedinUrl: 'https://www.linkedin.com/in/janedoe',
    });
  });

  it('strips a trailing slash from the profile URL', () => {
    const parsed = parseResult({
      ...CLEAN_THREE_PART,
      link: 'https://www.linkedin.com/in/janedoe/?trk=x',
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.linkedinUrl).toBe('https://www.linkedin.com/in/janedoe');
  });

  it('parses a 2-part title with an empty company', () => {
    const parsed = parseResult(CLEAN_TWO_PART);

    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('John Smith');
    expect(parsed?.title).toBe('Senior Recruiter');
    expect(parsed?.company).toBe('');
  });

  it('joins the middle segments of a 4-part title, company is last', () => {
    const parsed = parseResult(FOUR_PART);

    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('Sarah Lee');
    expect(parsed?.company).toBe('Acme Corp');
    expect(parsed?.title).toContain('Senior Technical');
    expect(parsed?.title).toContain('University Recruiter');
  });

  it('recovers a thin title from a rich snippet (stage 2)', () => {
    const parsed = parseResult(THIN_TITLE_RICH_SNIPPET);

    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('Jane Doe');
    expect(parsed?.title).toContain('University Recruiter');
    expect(parsed?.company).toContain('Acme Corp');
  });

  it('drops a thin title with an unhelpful snippet (no placeholder contact)', () => {
    const parsed = parseResult(THIN_TITLE_JUNK_SNIPPET);

    expect(parsed).toBeNull();
  });

  it('drops a company page link (not a /in/ profile)', () => {
    const parsed = parseResult(COMPANY_LINK);

    expect(parsed).toBeNull();
  });

  it('drops a non-LinkedIn link', () => {
    const parsed = parseResult(NON_LINKEDIN_LINK);

    expect(parsed).toBeNull();
  });

  // KNOWN LIMITATION — see LOCALIZED_EN_DASH fixture. Spec only guarantees the
  // ASCII " - " separator; en-dash localized titles are not in the contract.
  it.todo('parses localized en-dash separators (Recruiterin / Acme GmbH)');
});

// ============================================================================
// classifyTitle
// ============================================================================

describe('classifyTitle', () => {
  describe("presumedBucket 'recruiter'", () => {
    it('keeps a plain recruiter as recruiter', () => {
      expect(classifyTitle('Technical Recruiter', 'recruiter', PROFILE)).toBe('recruiter');
    });

    it('promotes a university recruiter (uni regex wins)', () => {
      expect(classifyTitle('University Recruiting Lead', 'recruiter', PROFILE)).toBe('university_recruiter');
    });

    it('rejects a non-recruiter title', () => {
      expect(classifyTitle('Software Engineer', 'recruiter', PROFILE)).toBeNull();
    });
  });

  describe("presumedBucket 'university_recruiter'", () => {
    it('keeps a campus recruiter as university_recruiter', () => {
      expect(classifyTitle('Campus Recruiter', 'university_recruiter', PROFILE)).toBe('university_recruiter');
    });

    it('demotes a generic sourcer to recruiter', () => {
      expect(classifyTitle('Talent Sourcer', 'university_recruiter', PROFILE)).toBe('recruiter');
    });

    it('rejects an unrelated title', () => {
      expect(classifyTitle('Barista', 'university_recruiter', PROFILE)).toBeNull();
    });
  });

  describe("presumedBucket 'alumni' (school query established the match)", () => {
    it('keeps an engineer alumnus as alumni', () => {
      expect(classifyTitle('Software Engineer', 'alumni', PROFILE)).toBe('alumni');
    });

    it('re-buckets an alumnus recruiter to recruiter', () => {
      expect(classifyTitle('Recruiter', 'alumni', PROFILE)).toBe('recruiter');
    });

    it('re-buckets an alumnus university recruiter to university_recruiter', () => {
      expect(classifyTitle('University Recruiter', 'alumni', PROFILE)).toBe('university_recruiter');
    });

    it('keeps a generic professional title as alumni', () => {
      expect(classifyTitle('Product Manager', 'alumni', PROFILE)).toBe('alumni');
    });
  });

  describe("presumedBucket 'engineer'", () => {
    it('keeps a software engineer as engineer', () => {
      expect(classifyTitle('Software Engineer', 'engineer', PROFILE)).toBe('engineer');
    });

    it('rejects a recruiter-regex hit even with "Engineer" present', () => {
      expect(classifyTitle('Recruiting Engineer Sourcer', 'engineer', PROFILE)).toBeNull();
    });

    it('rejects an unrelated title', () => {
      expect(classifyTitle('Barista', 'engineer', PROFILE)).toBeNull();
    });
  });
});

// ============================================================================
// isCurrentEmployee
// ============================================================================

describe('isCurrentEmployee', () => {
  it('matches when candidate company contains the job company', () => {
    const result = isCurrentEmployee(candidate({ company: 'Acme Corp' }), 'Acme', '');

    expect(result).toBe(true);
  });

  it('matches through punctuation/legal-suffix normalization', () => {
    const result = isCurrentEmployee(candidate({ company: 'Acme, Inc.' }), 'Acme Inc', '');

    expect(result).toBe(true);
  });

  it('rejects a different company', () => {
    const result = isCurrentEmployee(candidate({ company: 'Globex' }), 'Acme', '');

    expect(result).toBe(false);
  });

  it('falls back to the snippet when candidate company is empty', () => {
    const result = isCurrentEmployee(candidate({ company: '' }), 'Acme', 'Recruiter at Acme Corp in Eugene.');

    expect(result).toBe(true);
  });

  it('rejects a "Former Recruiter at Acme" snippet even when company matches', () => {
    const result = isCurrentEmployee(candidate({ company: 'Acme Corp' }), 'Acme', 'Former Recruiter at Acme. Now at Globex.');

    expect(result).toBe(false);
  });

  it('rejects an "ex-Acme" snippet even when company matches', () => {
    const result = isCurrentEmployee(candidate({ company: 'Acme Corp' }), 'Acme', 'ex-Acme recruiter, open to work.');

    expect(result).toBe(false);
  });

  it('rejects a "previously at Acme" snippet even when company matches', () => {
    const result = isCurrentEmployee(candidate({ company: 'Acme Corp' }), 'Acme', 'Recruiter, previously at Acme.');

    expect(result).toBe(false);
  });
});

// ============================================================================
// rankCandidates
// ============================================================================

describe('rankCandidates', () => {
  it('prefers bucket diversity over a second high-priority candidate', () => {
    const input: RankInput[] = [
      rankItem('university_recruiter', 'Uni One'),
      rankItem('university_recruiter', 'Uni Two'),
      rankItem('alumni', 'Alum One'),
      rankItem('recruiter', 'Rec One'),
      rankItem('engineer', 'Eng One'),
    ];

    const ranked = rankCandidates(input);

    expect(ranked).toHaveLength(3);

    const roleTypes = ranked.map((c: Contact) => c.roleType);

    expect(roleTypes).toContain('university_recruiter');
    expect(roleTypes).toContain('alumni');
    expect(roleTypes).toContain('recruiter');
    expect(roleTypes).not.toContain('engineer');

    // Only one university_recruiter despite two being available (diversity-first).
    const uniCount = roleTypes.filter((r: RoleType) => r === 'university_recruiter').length;

    expect(uniCount).toBe(1);
  });

  it('fills from a single bucket when that is all there is', () => {
    const input: RankInput[] = [
      rankItem('recruiter', 'Rec One'),
      rankItem('recruiter', 'Rec Two'),
      rankItem('recruiter', 'Rec Three'),
    ];

    const ranked = rankCandidates(input);

    expect(ranked).toHaveLength(3);
    expect(ranked.every((c: Contact) => c.roleType === 'recruiter')).toBe(true);
  });

  it('returns all candidates when fewer than the default max', () => {
    const input: RankInput[] = [
      rankItem('recruiter', 'Rec One'),
      rankItem('engineer', 'Eng One'),
    ];

    const ranked = rankCandidates(input);

    expect(ranked).toHaveLength(2);
  });

  it('returns an empty array for empty input', () => {
    expect(rankCandidates([])).toEqual([]);
  });

  it('carries name/title/linkedinUrl/roleType through onto the Contact', () => {
    const input: RankInput[] = [
      {
        candidate: candidate({
          name: 'Jane Doe',
          title: 'University Recruiter',
          company: 'Acme Corp',
          linkedinUrl: 'https://www.linkedin.com/in/janedoe',
        }),
        roleType: 'university_recruiter',
      },
    ];

    const ranked = rankCandidates(input);

    expect(ranked).toHaveLength(1);

    const [contact] = ranked;

    expect(contact.name).toBe('Jane Doe');
    expect(contact.title).toBe('University Recruiter');
    expect(contact.linkedinUrl).toBe('https://www.linkedin.com/in/janedoe');
    expect(contact.roleType).toBe('university_recruiter');
  });

  it('honors an explicit max override', () => {
    const input: RankInput[] = [
      rankItem('university_recruiter', 'Uni One'),
      rankItem('alumni', 'Alum One'),
      rankItem('recruiter', 'Rec One'),
      rankItem('engineer', 'Eng One'),
    ];

    const ranked = rankCandidates(input, 2);

    expect(ranked).toHaveLength(2);
    expect(ranked.map((c: Contact) => c.roleType)).toEqual(['university_recruiter', 'alumni']);
  });
});
