// @ts-check

/**
 * English strings. Keys are `area.thing`. Every user-facing string in the apps comes from
 * here (no hard-coded copy).
 */
export const en = Object.freeze({
  'app.name': 'Vouch',
  'app.tagline': 'Dating for verified college students.',

  // Common
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.retry': 'Try again',
  'common.loading': 'Loading…',
  'common.close': 'Close',
  'common.signOut': 'Sign out',
  'common.error': 'Something went wrong.',
  'common.offline': 'You are offline. We will reconnect automatically.',

  // Sign in
  'auth.title': 'Sign in with your college email',
  'auth.email.label': 'College email',
  'auth.email.placeholder': 'you@college.edu',
  'auth.email.invalid': 'Enter a valid email address.',
  'auth.email.notAllowed': 'This email’s college is not on Vouch yet.',
  'auth.code.title': 'Enter your code',
  'auth.code.label': 'Six-digit code',
  'auth.code.sent': 'We sent a code to {email}. It expires in 10 minutes.',
  'auth.code.invalid': 'That code is not right.',
  'auth.code.expired': 'The code has expired. Request a new one.',
  'auth.code.resend': 'Send a new code',
  'auth.signup.title': 'A few details first',
  'auth.signup.birthDate': 'Date of birth',
  'auth.signup.birthDate.hint': 'You must be 18 or older.',
  'auth.signup.underage': 'You must be 18 or older to use Vouch.',
  'auth.signup.consent': 'I agree to the privacy notice (version {version}).',
  'auth.signup.consent.required': 'Accept the privacy notice to continue.',
  'auth.signup.submit': 'Create my account',
  'auth.banned': 'This account has been suspended.',
  'auth.pendingReview': 'Your account is being reviewed. We will let you know soon.',
  'auth.rateLimited': 'Too many attempts. Wait a few minutes and try again.',

  // Home shell
  'home.tabs.discover': 'Discover',
  'home.tabs.matches': 'Matches',
  'home.tabs.chats': 'Chats',
  'home.tabs.profile': 'Profile',
  'home.empty.title': 'Coming soon',
  'home.empty.body': 'This part of Vouch arrives in the next release.',

  // Errors and system screens
  'error.title': 'Something went wrong',
  'error.body': 'Reload the page, or try again in a moment.',
  'notFound.title': 'Page not found',
  'notFound.body': 'The page you are looking for does not exist.',
  'notFound.home': 'Go home',
  'update.title': 'Update required',
  'update.body': 'This version of Vouch is no longer supported. Update the app to continue.',
  'update.action': 'Update',

  // Admin
  'admin.title': 'Vouch staff',
  'admin.login.email': 'Staff email',
  'admin.login.password': 'Password',
  'admin.login.totp': 'Authenticator code',
  'admin.login.submit': 'Sign in',
  'admin.login.failed': 'The email, password or code is wrong.',
  'admin.panels.title': 'Panels',
  'admin.panels.empty': 'No panels for your role.',
  'admin.panels.soon': 'This panel’s screen arrives in the next release.',

  // Components
  'ui.toast.dismiss': 'Dismiss notification',
  'ui.modal.close': 'Close dialog',
  'ui.otp.digit': 'Digit {n} of {total}',
});
