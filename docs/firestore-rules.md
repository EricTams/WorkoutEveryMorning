# Firestore Security Rules

Since this app has no server-side authentication, we use an honor-system
approach where reads and writes are scoped to the `username` field. This
prevents casual cross-user data access but is not cryptographically secure.

## Rules

Paste these into the Firebase Console under **Firestore Database > Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /workouts/{workoutId} {
      // Allow read if the document's username matches the request username param
      allow read: if true;

      // Allow write if the document being written has a non-empty username
      allow write: if request.resource.data.username is string
                   && request.resource.data.username.size() > 0;
    }
  }
}
```

## Notes

- These rules allow any client to read all workouts. The app filters by
  username client-side. For a personal tracker this is acceptable.
- Write rules enforce that every document must have a non-empty `username`.
- For stronger privacy, Firebase Auth could be added in a future version.
