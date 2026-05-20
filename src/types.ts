export type JobStatus = 'pending' | 'applied' | 'interview' | 'offer' | 'rejected';
export type RoleType = 'recruiter' | 'university_recruiter';

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
  outreachMessage?: string;
  connectionNote?: string;
}

export interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

export interface BraveSearchResponse {
  web?: { results: BraveWebResult[] };
}
