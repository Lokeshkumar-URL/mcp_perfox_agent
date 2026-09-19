const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN || "pit-7573220c-f652-49b5-8167-1f2b4c2e9fce";
const GHL_CALENDAR_ID = process.env.GHL_CALENDAR_ID || 'iPWIfTBBLTVmIqWcxtau';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || 'SlR2Rpw7DNDGHYawFcKi';

// GHL versions the calendars API per endpoint family:
//   GET  /calendars/:id/free-slots      -> v3
//   POST /calendars/events/appointments -> 2021-07-28
const GHL_VERSION_READ = 'v3';
const GHL_VERSION_WRITE = '2021-07-28';

async function ghlRequest(endpoint, options = {}) {
  const url = `${GHL_API_BASE}${endpoint}`;
  const { headers: headerOverrides, ...fetchOptions } = options;
  const method = (fetchOptions.method || 'GET').toUpperCase();

  const response = await fetch(url, {
    ...fetchOptions,
    headers: {
      'Authorization': `Bearer ${GHL_TOKEN}`,
      'Version': method === 'GET' ? GHL_VERSION_READ : GHL_VERSION_WRITE,
      'Content-Type': 'application/json',
      ...headerOverrides
    }
  });
  return response.json();
}

// The booking API takes a contactId, but the caller only has the customer's
// mobile number. /contacts/upsert resolves one to the other: it returns the
// existing contact for a known number, or creates a lead for a new one.
// Callers usually give the number the way the customer said it, without a
// country code, so default one in rather than failing the booking.
const DEFAULT_COUNTRY_CODE = '91';

function normalizePhone(raw) {
  const cleaned = String(raw ?? '').replace(/[\s()\-.]/g, '');

  // An explicit country code always wins.
  if (cleaned.startsWith('+')) {
    if (!/^\+\d{7,15}$/.test(cleaned)) {
      throw new Error(`Invalid mobile_number "${raw}".`);
    }
    return cleaned;
  }

  if (!/^\d+$/.test(cleaned)) {
    throw new Error(
      `Invalid mobile_number "${raw}". Expected a mobile number, e.g. 9360235499 or +919360235499.`
    );
  }

  // Drop the national trunk prefix: 09360235499 -> 9360235499
  const digits = cleaned.replace(/^0+/, '');

  // Country code present but the + was dropped: 919360235499
  if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY_CODE)) {
    return `+${digits}`;
  }

  // Bare national number: 9360235499
  if (/^[6-9]\d{9}$/.test(digits)) {
    return `+${DEFAULT_COUNTRY_CODE}${digits}`;
  }

  throw new Error(
    `Invalid mobile_number "${raw}". Expected a 10-digit mobile number (e.g. 9360235499) or full international format (e.g. +919360235499).`
  );
}

async function resolveContactId(mobileNumber, locationId) {
  const phone = normalizePhone(mobileNumber);
  const result = await ghlRequest('/contacts/upsert', {
    method: 'POST',
    body: JSON.stringify({ locationId, phone })
  });

  const entry = Array.isArray(result) ? result[0] : result;
  const contactId = entry?.contact?.id;
  if (!contactId) {
    throw new Error(
      `Could not resolve a GHL contact for ${phone}. Upsert returned: ${JSON.stringify(result)}`
    );
  }
  return contactId;
}


const mcpTools = {
  check_appointment_availability: {
    description:
      "Check available appointment slots for the customer's preferred date and time. Call this tool after the customer provides a date and time. Use the requested date to check GHL availability. If the requested time is available, inform the customer and ask for confirmation. If unavailable, show available slots for that date. Do not book the appointment.",
      inputSchema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description:
            "Start date in YYYY-MM-DD format for checking availability (e.g., 2026-09-16)."
        },
        end_date: {
          type: "string",
          description:
            "End date in YYYY-MM-DD format for checking availability (e.g., 2026-09-23). Must be within 31 days of start_date."
        },
        timezone: {
          type: "string",
          description:
            "Timezone for the slots (e.g., Asia/Kolkata, America/New_York). Defaults to Asia/Kolkata if not specified."
        },
        calendar_id: {
          type: "string",
          description:
            "Optional GHL calendar ID. Uses default calendar if not specified."
        }
      },
      required: ["start_date", "end_date"]
    },
    handler: async (params) => {
      const startDate = new Date(params.start_date).getTime();
      const endDate = new Date(params.end_date + 'T23:59:59').getTime();
      const timezone = encodeURIComponent(params.timezone || 'Asia/Kolkata');
      const calendarId = params.calendar_id || GHL_CALENDAR_ID;

      const endpoint = `/calendars/${calendarId}/free-slots?startDate=${startDate}&endDate=${endDate}&timezone=${timezone}`;
      return await ghlRequest(endpoint);
    }
  },

  book_appointment: {
    description:
      "Create and confirm a new appointment in the GoHighLevel calendar. Call this only after check_appointment_availability has confirmed the slot and the customer has agreed to it. Requires the customer's mobile number, which this tool resolves to a GHL contact automatically, plus the start and end time. Set the title for this specific visit from the project or area discussed with the customer.",
    inputSchema: {
      type: "object",
      properties: {
        mobile_number: {
          type: "string",
          description:
            "The customer's mobile number, exactly as they gave it (e.g., 9360235499 or +919360235499). The country code defaults to +91 when omitted. Ask the customer for this before booking. It is resolved to a GHL contact automatically."
        },
        start_time: {
          type: "string",
          description:
            "Appointment start time in ISO 8601 format with timezone (e.g., 2026-09-16T15:00:00+05:30)."
        },
        end_time: {
          type: "string",
          description:
            "Appointment end time in ISO 8601 format with timezone (e.g., 2026-09-16T15:30:00+05:30)."
        },
        title: {
          type: "string",
          description:
            "Required, conversation-specific title. Use 'Site Visit - <project or area>' when the customer named one; use 'Site Visit' only when no project or area was settled. Never reuse a fixed generic title."
        },
        calendar_id: {
          type: "string",
          description:
            "Optional GHL calendar ID. Uses default calendar if not specified."
        },
        location_id: {
          type: "string",
          description:
            "Optional GHL location ID. Uses default location if not specified."
        },
        appointment_status: {
          type: "string",
          description:
            "Appointment status (e.g., confirmed, pending, cancelled). Defaults to confirmed."
        }
      },
      required: ["mobile_number", "start_time", "end_time", "title"]
    },
    handler: async (params) => {
      const title = typeof params.title === 'string' ? params.title.trim() : '';
      if (!title) {
        throw new Error('A title based on the customer\'s visit is required.');
      }

      const calendarId = params.calendar_id || GHL_CALENDAR_ID;
      const locationId = params.location_id || GHL_LOCATION_ID;
      const contactId = await resolveContactId(params.mobile_number, locationId);

      const endpoint = '/calendars/events/appointments';
      return await ghlRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          calendarId: calendarId,
          locationId: locationId,
          contactId: contactId,
          startTime: params.start_time,
          endTime: params.end_time,
          title,
          appointmentStatus: params.appointment_status || 'confirmed'
        })
      });
    }
  }
};

export { mcpTools };
