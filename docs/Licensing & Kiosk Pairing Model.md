Licensing & Kiosk Pairing Model
(Addendum to Core System Plan)

This document defines the licensing behaviour, module licensing, and kiosk pairing mechanism for the Visitor Entry Management System (VEMS).

It intentionally avoids hard cut-offs and prioritises operational continuity, safety, and good customer experience, particularly for schools and public-sector environments.

1. Licensing Philosophy
Core principle

The system must never suddenly stop working due to licensing.

Licensing controls:

access to support

access to software updates

commercial entitlement (kiosk count, modules)

Licensing does not:

disable critical safety features

block sign-in/out without warning

break day-to-day operations

2. Licence Scope

Licensing applies at the portal level (one portal per customer).

All Sites and Kiosks within the portal inherit the same licence state.

Kiosk limits are enforced at provisioning time, not at runtime.

3. Licence Types
3.1 Core Licence

The Core Licence represents:

the right to operate the system

the support & update period

the maximum number of kiosks allowed

Core Licence fields:

Licence Reference (unique, human-readable)

Start Date

Support & Updates End Date

Kiosk Limit

Notes / Audit log

There is always exactly one Core Licence per portal.

3.2 Module Licences (Add-ons)

Modules are licensed in addition to the Core Licence.

Examples:

Events Module

Meetings Module

Facial Recognition Module

Advanced Reporting Module

Each module has:

its own start date

its own support & updates end date

Modules depend on the Core Licence being present, but are not hard-disabled when Core expires.

4. Licence States & Behaviour
4.1 Active (In Support)

Condition:

Current date ≤ Support & Updates End Date

Behaviour:

Full functionality

All purchased modules available

Software updates enabled

Support available

4.2 Out of Support (Expired, but Operational)

Condition:

Current date > Support & Updates End Date

This is the default expiry state.

Behaviour:

✅ System continues to operate normally

✅ Kiosks continue sign-in / sign-out

✅ Badge printing continues

✅ Fire roll call always available

✅ Admin access continues

⚠️ No software updates

⚠️ No support entitlement

User-facing message (exact wording):

“Your support and updates period ended on 31 Dec 2026.
The system will continue to operate, but updates and support are no longer available.”

This message appears:

in the admin dashboard

optionally on kiosks (small footer/banner)

in renewal reminder emails

4.3 Suspended (Manual Only)

Suspension is never automatic.

Used only for:

contract termination

extreme non-payment

misuse or abuse

Behaviour:

Kiosks allow sign-out only

Fire roll call remains accessible

Admin dashboard restricted to licence page

Suspension requires explicit supplier/admin action and confirmation.

5. Module Behaviour When Licences Expire
Key rule

Modules are never suddenly disabled during normal operation.

When a module expires:

Module continues to function

Module no longer receives updates

Module shows “Out of Support” in admin UI

When Core Licence expires:

All modules remain available

No modules receive updates

Clear renewal messaging is shown

If Core is renewed later:

Any modules still within their support period automatically return to “In Support”

This avoids:

mid-term feature loss

confusion for staff

unsafe operational gaps

6. Kiosk Limits (Enforcement Point)

Kiosk limits are enforced only when linking a new kiosk.

Existing kiosks are never disabled automatically.

Rule:

If active kiosks ≥ licensed kiosk limit
→ pairing/linking a new kiosk is blocked.

Message shown:

“This site is licensed for 2 kiosks. You currently have 2 linked.”

Supplier/admin can:

increase kiosk limit

deactivate old kiosks

replace hardware without penalty

7. Kiosk Pairing (Plex-style Code)
7.1 Purpose

Kiosk Pairing provides a secure, simple way to register kiosks without typing credentials on a public device.

This follows the same pattern used by:

Plex

Netflix (TV login)

YouTube (TV login)

7.2 Pairing Flow
On the Kiosk

Kiosk starts unregistered

Displays:

This kiosk is not linked.

Go to:
portal.example.com/link

Enter this code:
K7F9-Q2

Code is short-lived (e.g. 10 minutes)

Kiosk polls server awaiting approval

In the Admin Portal

Admin logs in

Navigates to Link a Kiosk

Enters pairing code

Selects:

Site

Kiosk name (e.g. “Reception Desk”)

System checks:

licence status

kiosk limit

If valid → kiosk is linked

7.3 After Pairing

Kiosk receives a long-lived kiosk token

Token is stored securely on the device

Kiosk no longer shows pairing screen

Kiosk begins normal operation

7.4 Security Characteristics

No passwords on kiosks

Codes are short-lived and single-use

Tokens can be revoked at any time

Lost or replaced kiosks can be disabled instantly

8. Supplier / Admin Controls

Supplier or internal admin users can:

extend Core Licence dates

extend Module Licence dates

increase kiosk limits

revoke or suspend kiosks

view licence history and notes

This supports real-world scenarios such as:

delayed school funding

phased rollouts

early installs before provisioning

9. Why This Model Was Chosen

This model:

avoids safety risks

prevents angry cut-offs

matches public-sector expectations

reduces support friction

keeps renewals calm and professional

avoids complex licence key systems

works cleanly with on-prem portals

It can be tightened later if required — but starts from a position of trust and continuity.

10. Summary (TL;DR)

Licences control support & updates, not basic operation

The system never hard-stops automatically

Expiry = “Out of Support”, not “Disabled”

Modules follow the same rule

Kiosk limits are enforced at pairing time

Plex-style pairing codes are the standard way to link kiosks

Manual suspension exists only as a last resort