import type { UserInfo } from '@collab/shared';

interface UserListProps {
  me: UserInfo | null;
  users: readonly UserInfo[];
}

export function UserList({ me, users }: UserListProps) {
  const count = users.length + (me ? 1 : 0);
  return (
    <aside className="user-list" aria-label="People in this room">
      <h2 className="user-list__title">
        People <span className="user-list__count">{count}</span>
      </h2>
      <ul>
        {me && <UserRow user={me} label={`${me.name} (you)`} />}
        {users.map((u) => (
          <UserRow key={u.clientId} user={u} label={u.name} />
        ))}
      </ul>
    </aside>
  );
}

function UserRow({ user, label }: { user: UserInfo; label: string }) {
  return (
    <li className="user-list__row" title={label}>
      <span className="user-list__swatch" style={{ backgroundColor: user.color }} aria-hidden="true" />
      <span className="user-list__name">{label}</span>
    </li>
  );
}
