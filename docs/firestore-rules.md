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
    function hasUsername(data) {
      return data.username is string && data.username.size() > 0;
    }

    match /workouts/{workoutId} {
      allow read: if true;
      allow write: if hasUsername(request.resource.data);
    }

    match /healthMeasurements/{healthId} {
      allow read: if true;
      allow write: if hasUsername(request.resource.data);
    }

    match /activities/{activityId} {
      allow read: if true;
      allow write: if hasUsername(request.resource.data)
                   && request.resource.data.activityName is string
                   && request.resource.data.activityName.size() > 0;
    }

    match /healthMetricMeta/{metaId} {
      allow read: if true;
      allow write: if hasUsername(request.resource.data);
    }

    match /stretches/{stretchId} {
      allow read: if true;
      allow write: if hasUsername(request.resource.data);
    }
  }
}
```

## Notes

- These rules allow any client to read all documents. The app filters by
  username client-side. For a personal tracker this is acceptable.
- Write rules enforce that every document must have a non-empty `username`.
- The `activities` collection additionally requires a non-empty `activityName`.
- For stronger privacy, Firebase Auth could be added in a future version.
