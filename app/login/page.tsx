import { redirect } from 'next/navigation';

// The app shows the sign-in screen when signed out.
export default function LoginPage() {
  redirect('/app');
}
