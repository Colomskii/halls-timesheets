# Hall's Timesheets

A web-based timesheet management system designed to replace paper forms with a straightforward digital process for employees and administrators.

Hall's Timesheets allows employees to complete, submit and revisit their timesheets, while giving administrators a central place to review submissions, provide feedback and maintain records. The interface is designed for use on both desktop and mobile devices, with printable documents available when a physical copy is required.

## Features

### For employees
- **Digital timesheets:** Complete and submit timesheets online.
- **Flexible entries:** Add rows as needed and create additional sheets when a form requires more space.
- **Submission history:** View previously submitted timesheets and their current status.
- **Return feedback:** See the administrator's reason when a timesheet is returned for correction.
- **Print and PDF:** Print timesheets or save a landscape-oriented PDF copy.

### For administrators
- **Centralised review:** Access employee timesheet submissions in one place.
- **Review workflow:** Review timesheets and return them with an explanatory note where changes are needed.
- **Record management:** Manage historical submissions and delete timesheets when necessary, with a confirmation step to help prevent accidental deletion.
- **Employee accounts:** Manage access for employees without requiring manual entry of Firebase user IDs in the interface.

## Technology

| Component | Technology |
| --- | --- |
| Frontend | React, Vite, JavaScript and CSS |
| Authentication | Firebase Authentication |
| Database | Cloud Firestore |
| Hosting and deployment | Netlify |
| Version control | Git and GitHub |


### Prerequisites
- Node.js and npm
- A Firebase project configured for Authentication and Cloud Firestore
- Access to the project's Firebase configuration and appropriate Firestore security rules

### Deployment

The project is set up for deployment through **Netlify**, with changes published from the connected GitHub repository. Production deployments should use the correct Firebase project configuration, authorised authentication domains and Firestore security rules.

## Access and data protection

The application distinguishes between employee and administrator access. Authentication establishes who a user is; **Firestore security rules must also enforce which records and administrative actions that user can access**. Interface restrictions alone are not a substitute for database-level permissions.

Timesheets may contain personal and employment-related information. Administrators should follow their organisation's retention, access-control and data-protection policies when managing records and exports.

## Project purpose

Hall's Timesheets was developed to make day-to-day timesheet administration more efficient by reducing reliance on paper forms, improving visibility of submitted records and making corrections easier to communicate. The aim is to keep the original timesheet workflow familiar while making it easier to use, manage and archive digitally.

## Development status

This is an actively developed application. Features and workflows may change as the system is tested and refined.
