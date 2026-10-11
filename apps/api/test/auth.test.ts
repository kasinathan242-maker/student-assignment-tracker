import type { Express } from 'express';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env, setEnv } from '../src/config/env';
import { hashToken } from '../src/lib/crypto';
import { AuditLog, Invitation, Membership, OutboxEvent, Session, User } from '../src/models';
import {
  api,
  Client,
  addMember,
  createOrg,
  createUser,
  flushOutbox,
  mailbox,
  PASSWORD,
  signedIn,
  startTestApp,
  stopTestApp,
  tokenFromEmail,
} from './helpers';

let app: Express;
beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

describe('CSRF', () => {
  it('rejects state-changing requests without a valid token', async () => {
    const client = new Client(app);
    const res = await client.agent
      .post(api('/auth/login'))
      .send({ email: 'x@example.edu', password: 'whatever' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_invalid');
    const forged = await client.agent
      .post(api('/auth/login'))
      .set('x-csrf-token', 'abc.def')
      .set('Cookie', 'sat_csrf=abc.def')
      .send({});
    expect(forged.body.error.code).toBe('csrf_invalid');
  });
});

describe('registration and verification', () => {
  it('returns the same generic response for new and existing emails, and cannot set roles', async () => {
    const existing = await createUser();
    const client = await new Client(app).init();
    const fresh = await client.post('/auth/register', {
      name: 'New Person',
      email: 'new.person@example.edu',
      password: PASSWORD,
    });
    const dup = await client.post('/auth/register', {
      name: 'Someone',
      email: existing.email,
      password: PASSWORD,
    });
    expect(fresh.status).toBe(202);
    expect(dup.status).toBe(202);
    expect(fresh.body).toEqual(dup.body);
    const escalate = await client.post('/auth/register', {
      name: 'Evil',
      email: 'evil@example.edu',
      password: PASSWORD,
      role: 'org_admin',
    });
    expect(escalate.status).toBe(400);
    const escalate2 = await client.post('/auth/register', {
      name: 'Evil',
      email: 'evil@example.edu',
      password: PASSWORD,
      platformRole: 'platform_admin',
    });
    expect(escalate2.status).toBe(400);
    await flushOutbox();
    expect(
      mailbox().sent.some((m) => m.to === existing.email && m.subject.includes('already have an account')),
    ).toBe(true);
  });

  it('requires email verification before sign-in and verifies with a single-use token', async () => {
    const client = await new Client(app).init();
    const email = 'verify.me@example.edu';
    await client.post('/auth/register', { name: 'Verify Me', email, password: PASSWORD });
    const blocked = await client.login(email);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('email_not_verified');
    await flushOutbox();
    const token = tokenFromEmail(email, '/verify-email');
    expect(await OutboxEvent.countDocuments({ 'payload.vars': { $regex: token } })).toBe(0); // never stored in plaintext
    const wrongPassword = await client.post('/auth/verify-email', { token, password: 'not my password' });
    expect(wrongPassword.status).toBe(400);
    expect(wrongPassword.body.error.code).toBe('invalid_password');
    const ok = await client.post('/auth/verify-email', { token, password: PASSWORD }); // token survived the failed attempt
    expect(ok.status).toBe(200);
    const reuse = await client.post('/auth/verify-email', { token, password: PASSWORD });
    expect(reuse.status).toBe(400);
    const login = await client.login(email);
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toMatch(/passwordHash|argon2/);
  });

  it('rejects weak passwords server-side', async () => {
    const client = await new Client(app).init();
    const res = await client.post('/auth/register', {
      name: 'Weak',
      email: 'weak@example.edu',
      password: 'password1234',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.password).toBeDefined();
  });

  it('signs in directly when registering through an invitation for the invited email only', async () => {
    const org = await createOrg();
    const token = 'invitation-token-abcdefghijklmnop';
    await Invitation.create({
      orgId: org._id,
      email: 'invited@example.edu',
      role: 'teacher',
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const client = await new Client(app).init();
    const wrong = await client.post('/auth/register', {
      name: 'Other',
      email: 'other@example.edu',
      password: PASSWORD,
      invitationToken: token,
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('invitation_email_mismatch');
    const res = await client.post('/auth/register', {
      name: 'Invited',
      email: 'invited@example.edu',
      password: PASSWORD,
      invitationToken: token,
    });
    expect(res.status).toBe(201);
    expect(res.body.me.memberships[0]).toMatchObject({ role: 'teacher', status: 'active' });
    const reuse = await new Client(app).init().then((c) =>
      c.post('/auth/register', {
        name: 'Again',
        email: 'invited@example.edu',
        password: PASSWORD,
        invitationToken: token,
      }),
    );
    expect(reuse.status).toBe(400);
  });
});

describe('login, sessions and lockout', () => {
  it('uses one generic error for unknown accounts and wrong passwords', async () => {
    const user = await createUser();
    const client = await new Client(app).init();
    const unknown = await client.login('nobody@example.edu', 'some password here');
    const wrong = await client.login(user.email, 'not the right password');
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('locks an account after repeated failures', async () => {
    const user = await createUser();
    const client = await new Client(app).init();
    for (let i = 0; i < 10; i += 1) await client.login(user.email, 'wrong password attempt');
    const locked = await client.login(user.email);
    expect(locked.status).toBe(429);
    expect(await AuditLog.exists({ action: 'auth.account.locked', actorId: user._id })).toBeTruthy();
  });

  it('rotates refresh tokens and revokes the session when an old token is replayed', async () => {
    const user = await createUser();
    const client = await signedIn(app, user);
    const oldCookie = (await Session.findOne({ userId: user._id }))?.refreshTokenHash;
    const cookies = client.agent.jar.getCookies({
      domain: '127.0.0.1',
      path: '/api/v1/auth',
      secure: false,
      script: false,
    });
    const refreshCookie = cookies.find((c) => c.name === 'sat_rt');
    expect(refreshCookie).toBeDefined();
    const rotated = await client.post('/auth/refresh');
    expect(rotated.status).toBe(200);
    client.csrf = rotated.body.csrfToken;
    expect((await Session.findOne({ userId: user._id }))?.refreshTokenHash).not.toBe(oldCookie);

    // Replay the stolen (old) refresh token from another client.
    const attacker = await new Client(app).init();
    const replay = await attacker.agent
      .post(api('/auth/refresh'))
      .set('x-csrf-token', attacker.csrf)
      .set('Cookie', `sat_rt=${refreshCookie?.value}; sat_csrf=${attacker.csrf}`);
    expect(replay.status).toBe(401);
    const session = await Session.findOne({ userId: user._id });
    expect(session?.revokedReason).toBe('refresh_token_replay');
    // The legitimate client is now signed out too.
    expect((await client.get('/me')).status).toBe(401);
  });

  it('logout revokes the session immediately', async () => {
    const user = await createUser();
    const client = await signedIn(app, user);
    expect((await client.get('/me')).status).toBe(200);
    const stolenCookies = client.agent.jar
      .getCookies({ domain: '127.0.0.1', path: '/api', secure: false, script: false })
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    expect((await client.post('/auth/logout')).status).toBe(204);
    const reused = await new Client(app).agent.get(api('/me')).set('Cookie', stolenCookies);
    expect(reused.status).toBe(401);
  });

  it('rejects expired and forged access tokens', async () => {
    const user = await createUser();
    const client = await signedIn(app, user);
    const session = await Session.findOne({ userId: user._id });
    const key = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);
    const expired = await new SignJWT({ sid: session?._id.toString() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user._id.toString())
      .setIssuer('sat-api')
      .setAudience('sat-web')
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(key);
    const res = await new Client(app).agent.get(api('/me')).set('Cookie', `sat_at=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('token_expired');
    const forged = await new SignJWT({ sid: session?._id.toString() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user._id.toString())
      .setIssuer('sat-api')
      .setAudience('sat-web')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('attacker-secret-attacker-secret-attacker'));
    expect((await new Client(app).agent.get(api('/me')).set('Cookie', `sat_at=${forged}`)).status).toBe(401);
    expect((await client.get('/me')).status).toBe(200);
  });

  it('suspended accounts lose access on their next request', async () => {
    const user = await createUser();
    const client = await signedIn(app, user);
    await User.updateOne({ _id: user._id }, { $set: { status: 'suspended' } });
    const res = await client.get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('account_inactive');
  });
});

describe('password reset and change', () => {
  it('does not reveal whether an email exists and resets with a single-use token', async () => {
    const user = await createUser();
    const client = await new Client(app).init();
    const a = await client.post('/auth/forgot-password', { email: user.email });
    const b = await client.post('/auth/forgot-password', { email: 'ghost@example.edu' });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
    const other = await signedIn(app, user);
    await flushOutbox();
    const token = tokenFromEmail(user.email, '/reset-password');
    const newPassword = 'a brand new passphrase 42';
    expect((await client.post('/auth/reset-password', { token, password: newPassword })).status).toBe(200);
    expect(
      (await client.post('/auth/reset-password', { token, password: 'another passphrase 43' })).status,
    ).toBe(400);
    expect((await other.get('/me')).status).toBe(401); // all sessions revoked
    expect((await client.login(user.email, newPassword)).status).toBe(200);
  });

  it('changing the password signs out other sessions but keeps the current one', async () => {
    const user = await createUser();
    const laptop = await signedIn(app, user);
    const phone = await signedIn(app, user);
    const wrong = await laptop.put('/me/password', {
      currentPassword: 'nope nope nope',
      newPassword: 'a different passphrase 7',
    });
    expect(wrong.status).toBe(400);
    expect(
      (
        await laptop.put('/me/password', {
          currentPassword: PASSWORD,
          newPassword: 'a different passphrase 7',
        })
      ).status,
    ).toBe(204);
    expect((await laptop.get('/me')).status).toBe(200);
    expect((await phone.get('/me')).status).toBe(401);
  });
});

describe('profile and sessions', () => {
  it('ignores mass-assignment of protected fields', async () => {
    const user = await createUser();
    const client = await signedIn(app, user);
    const res = await client.patch('/me', { name: 'Renamed', platformRole: 'platform_admin' });
    expect(res.status).toBe(400);
    const ok = await client.patch('/me', { name: 'Renamed', timezone: 'Europe/Berlin' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Renamed', timezone: 'Europe/Berlin', platformRole: null });
  });

  it('lists and revokes own sessions only', async () => {
    const user = await createUser();
    const other = await createUser();
    const a = await signedIn(app, user);
    await signedIn(app, user);
    await signedIn(app, other);
    const list = await a.get('/me/sessions');
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const otherSession = await Session.findOne({ userId: other._id });
    expect((await a.delete(`/me/sessions/${otherSession?._id.toString()}`)).status).toBe(404);
    expect((await a.post('/me/sessions/revoke-others')).body.revoked).toBe(1);
  });

  it('joins an organization with a join code only when self-registration allows it', async () => {
    const org = await createOrg();
    await (
      await import('../src/models')
    ).Organization.updateOne(
      { _id: org._id },
      { $set: { joinCode: 'JOINME42', 'settings.selfRegistration': 'approval' } },
    );
    const user = await createUser();
    const client = await signedIn(app, user);
    const res = await client.post('/me/join', { joinCode: 'joinme42' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect((await Membership.findOne({ orgId: org._id, userId: user._id }))?.role).toBe('student');
    expect((await client.get(`/orgs/${org._id.toString()}`)).status).toBe(404); // pending members have no access

    // A member removed by an administrator cannot rejoin through the public code, even in "open" mode.
    const { Organization } = await import('../src/models');
    await Organization.updateOne({ _id: org._id }, { $set: { 'settings.selfRegistration': 'open' } });
    await Membership.updateOne({ orgId: org._id, userId: user._id }, { $set: { status: 'revoked' } });
    const rejoin = await client.post('/me/join', { joinCode: 'JOINME42' });
    expect(rejoin.status).toBe(403);
    expect(rejoin.body.error.code).toBe('membership_revoked');
    expect((await Membership.findOne({ orgId: org._id, userId: user._id }))?.status).toBe('revoked');
  });

  it('prevents pre-account takeover: an address registered by someone else cannot be verified without their password', async () => {
    const victim = 'victim.owner@example.edu';
    const attacker = await new Client(app).init();
    await attacker.post('/auth/register', {
      name: 'Not the owner',
      email: victim,
      password: 'attacker chosen pass 1',
    });
    await flushOutbox();
    const token = tokenFromEmail(victim, '/verify-email');
    // The real owner clicks the link but does not know the attacker's password: nothing is verified.
    const owner = await new Client(app).init();
    const attempt = await owner.post('/auth/verify-email', { token, password: 'owner guesses something' });
    expect(attempt.status).toBe(400);
    expect((await User.findOne({ email: victim }))?.emailVerifiedAt).toBeNull();
    expect((await attacker.login(victim, 'attacker chosen pass 1')).status).toBe(403); // still unverified
  });
});

describe('with email verification switched off (the default)', () => {
  let original: ReturnType<typeof env>;
  beforeAll(() => {
    original = env();
    setEnv({ ...original, REQUIRE_EMAIL_VERIFICATION: false });
  });
  afterAll(() => setEnv(original));

  it('lets a new account sign in straight away, without sending a confirmation email', async () => {
    const client = await new Client(app).init();
    const email = 'no.verify@example.edu';
    const res = await client.post('/auth/register', { name: 'No Verify', email, password: PASSWORD });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('account_ready');
    await flushOutbox();
    expect(mailbox().sent.some((m) => m.to === email && m.subject.includes('Confirm'))).toBe(false);
    const login = await client.login(email);
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe(email);
  });

  it('gives the same answer for an existing email and never replaces its password', async () => {
    // Nobody proves inbox ownership in this mode, so registering again must not take over the account,
    // whether or not it was ever verified.
    for (const verified of [true, false]) {
      const owner = await createUser({ verified });
      const intruder = await new Client(app).init();
      const res = await intruder.post('/auth/register', {
        name: 'Intruder',
        email: owner.email,
        password: 'intruder chosen passphrase',
      });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('account_ready');
      expect(
        (await intruder.post('/auth/login', { email: owner.email, password: 'intruder chosen passphrase' }))
          .status,
      ).toBe(401);
      expect((await signedIn(app, owner)).csrf).toBeTruthy(); // the owner's password still works
    }
  });

  it('lets an unverified account sign in and use a join code', async () => {
    const org = await createOrg();
    const { Organization } = await import('../src/models');
    await Organization.updateOne(
      { _id: org._id },
      { $set: { joinCode: 'OPENJOIN7', 'settings.selfRegistration': 'open' } },
    );
    const user = await createUser({ verified: false });
    const client = await signedIn(app, user);
    const res = await client.post('/me/join', { joinCode: 'OPENJOIN7' });
    expect(res.status).toBe(200);
  });
});

describe('separate Student, Teacher and HOD / Admin logins', () => {
  const loginVia = async (email: string, portal: string, password = PASSWORD) =>
    (await new Client(app).init()).post('/auth/login', { email, password, portal });

  it('admits each account only through the login for its role', async () => {
    const org = await createOrg();
    const student = await createUser();
    const teacher = await createUser();
    const hod = await createUser();
    await addMember(org, student, 'student');
    await addMember(org, teacher, 'teacher');
    await addMember(org, hod, 'org_admin');

    expect((await loginVia(student.email, 'student')).status).toBe(200);
    expect((await loginVia(teacher.email, 'teacher')).status).toBe(200);
    expect((await loginVia(hod.email, 'admin')).status).toBe(200);

    const wrong = await loginVia(student.email, 'teacher');
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('wrong_portal');
    expect(wrong.body.error.message).toBe(
      'This account cannot use the Teacher login. Use the Student login.',
    );
    expect((await loginVia(teacher.email, 'admin')).body.error.code).toBe('wrong_portal');
    expect((await loginVia(hod.email, 'student')).body.error.code).toBe('wrong_portal');
    // No session is created by a refused login.
    expect(await Session.countDocuments({ userId: student._id, revokedAt: null })).toBe(1);
  });

  it('reveals nothing about the role until the password is right', async () => {
    const org = await createOrg();
    const teacher = await createUser();
    await addMember(org, teacher, 'teacher');
    const res = await loginVia(teacher.email, 'student', 'definitely not the password');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });

  it('sends platform administrators to the HOD / Admin login and new accounts to the Student login', async () => {
    const platform = await createUser({ platformRole: 'platform_admin' });
    expect((await loginVia(platform.email, 'admin')).status).toBe(200);
    expect((await loginVia(platform.email, 'student')).body.error.code).toBe('wrong_portal');
    const newcomer = await createUser(); // has not joined an organization yet
    expect((await loginVia(newcomer.email, 'student')).status).toBe(200);
    expect((await loginVia(newcomer.email, 'teacher')).body.error.code).toBe('wrong_portal');
  });

  it('only counts memberships that are active', async () => {
    const org = await createOrg();
    const former = await createUser();
    await Membership.create({
      orgId: org._id,
      userId: former._id,
      role: 'teacher',
      status: 'revoked',
      joinedAt: new Date(),
    });
    expect((await loginVia(former.email, 'teacher')).body.error.code).toBe('wrong_portal');
  });
});
