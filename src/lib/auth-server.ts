import { NextRequest } from 'next/server';
import { adminAuth } from './firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';

export interface AuthenticatedUser {
  uid: string;
  email: string;
}

export async function verifyRequestUser(
  request: NextRequest
): Promise<AuthenticatedUser | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return null;
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email ?? '';
    await getOrCreateUser(decoded.uid, email);
    return {
      uid: decoded.uid,
      email,
    };
  } catch (error) {
    console.error('Firebase ID token verification failed:', error);
    return null;
  }
}
