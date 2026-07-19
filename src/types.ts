// ============================================================================
// Domain Types
// ============================================================================

export type JobStatus = 'pending' | 'applied' | 'interview' | 'offer' | 'rejected';
export type RoleType = 'recruiter' | 'university_recruiter' | 'alumni' | 'engineer';

// ============================================================================
// Interfaces
// ============================================================================

export interface JobPosting {
  id?: string;
  url: string;
  company: string;
  title: string;
  description: string;
  location?: string;
  salaryRange?: string;
  requirements?: string;
  coverLetter?: string;
  status?: JobStatus;
}

export interface Contact {
  id?: string;
  jobId?: string;
  name: string;
  title: string;
  linkedinUrl?: string;
  company: string;
  roleType: RoleType;
  connectionNote?: string;
}
