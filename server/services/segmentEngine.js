// segmentEngine.js — compiles a small, validated rule AST into MongoDB match query.
import { getCollection, ObjectId } from '../db.js';

const FIELDS = {
  total_spend:     { type: 'number' },
  order_count:     { type: 'number' },
  avg_order_value: { type: 'number' },
  last_order_days: { type: 'number' }, // days since last order
  tenure_days:     { type: 'number' },
  city:            { type: 'string' },
};

const OPS = {
  number: { '>': '$gt', '>=': '$gte', '<': '$lt', '<=': '$lte', '=': '$eq', '!=': '$ne' },
  string: { '=': '$eq', '!=': '$ne', contains: '$regex' },
};

export function validateRules(rules) {
  if (!rules || typeof rules !== 'object') throw new Error('rules must be an object');
  const logic = (rules.logic || 'AND').toUpperCase();
  if (!['AND', 'OR'].includes(logic)) throw new Error(`logic must be AND or OR, got "${rules.logic}"`);
  if (!Array.isArray(rules.conditions) || rules.conditions.length === 0)
    throw new Error('conditions must be a non-empty array');
  if (rules.conditions.length > 12) throw new Error('too many conditions (max 12)');

  const conditions = rules.conditions.map((c, i) => {
    const field = FIELDS[c.field];
    if (!field) throw new Error(`condition ${i}: unknown field "${c.field}"`);
    const op = OPS[field.type][c.op];
    if (!op) throw new Error(`condition ${i}: op "${c.op}" not valid for ${c.field}`);
    if (field.type === 'number' && typeof c.value !== 'number')
      throw new Error(`condition ${i}: ${c.field} needs a numeric value`);
    if (field.type === 'string' && typeof c.value !== 'string')
      throw new Error(`condition ${i}: ${c.field} needs a string value`);
    return { field: c.field, op: c.op, value: c.value };
  });
  return { logic, conditions };
}

function compile(rules, channel = null) {
  const { logic, conditions } = validateRules(rules);
  const clauses = [];
  
  for (const c of conditions) {
    const f = FIELDS[c.field];
    const mongoOp = OPS[f.type][c.op];
    if (c.op === 'contains') {
      clauses.push({ [c.field]: { $regex: c.value, $options: 'i' } });
    } else {
      clauses.push({ [c.field]: { [mongoOp]: c.value } });
    }
  }

  let matchQuery = {};
  if (clauses.length > 0) {
    matchQuery = logic === 'AND' ? { $and: clauses } : { $or: clauses };
  }

  if (channel) {
    const consentField = `consent_${channel.toLowerCase()}`;
    if (Object.keys(matchQuery).length === 0) {
      matchQuery = { [consentField]: 1 };
    } else {
      matchQuery = { $and: [matchQuery, { [consentField]: 1 }] };
    }
  }

  return matchQuery;
}

export async function previewSegment(rules, { limit = 8, channel = null } = {}) {
  const matchQuery = compile(rules, channel);
  const customersColl = getCollection('customers');

  const pipeline = [
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'customer_id',
        as: 'orders'
      }
    },
    {
      $project: {
        first_name: 1,
        last_name: 1,
        email: 1,
        phone: 1,
        city: 1,
        consent_email: 1,
        consent_sms: 1,
        consent_whatsapp: 1,
        created_at: 1,
        total_spend: { $sum: '$orders.amount' },
        order_count: { $size: '$orders' },
        avg_order_value: {
          $cond: [
            { $gt: [{ $size: '$orders' }, 0] },
            { $avg: '$orders.amount' },
            0
          ]
        },
        last_order_days: {
          $cond: [
            { $gt: [{ $size: '$orders' }, 0] },
            {
              $floor: {
                $divide: [
                  { $subtract: [new Date(), { $max: '$orders.created_at' }] },
                  1000 * 60 * 60 * 24
                ]
              }
            },
            999999
          ]
        },
        tenure_days: {
          $floor: {
            $divide: [
              { $subtract: [new Date(), '$created_at'] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      }
    },
    { $match: matchQuery }
  ];

  const allMatching = await customersColl.aggregate(pipeline).toArray();
  const size = allMatching.length;

  let sample = [];
  if (limit > 0 && size > 0) {
    const samplePipeline = [
      ...pipeline,
      { $sort: { total_spend: -1 } },
      { $limit: limit }
    ];
    sample = await customersColl.aggregate(samplePipeline).toArray();
  }

  return {
    size,
    sample: sample.map(s => ({ ...s, id: s._id.toString() }))
  };
}

export async function resolveSegment(rules, { channel = null } = {}) {
  const matchQuery = compile(rules, channel);
  const customersColl = getCollection('customers');

  const pipeline = [
    {
      $lookup: {
        from: 'orders',
        localField: '_id',
        foreignField: 'customer_id',
        as: 'orders'
      }
    },
    {
      $project: {
        first_name: 1,
        last_name: 1,
        email: 1,
        phone: 1,
        city: 1,
        consent_email: 1,
        consent_sms: 1,
        consent_whatsapp: 1,
        created_at: 1,
        total_spend: { $sum: '$orders.amount' },
        order_count: { $size: '$orders' },
        avg_order_value: {
          $cond: [
            { $gt: [{ $size: '$orders' }, 0] },
            { $avg: '$orders.amount' },
            0
          ]
        },
        last_order_days: {
          $cond: [
            { $gt: [{ $size: '$orders' }, 0] },
            {
              $floor: {
                $divide: [
                  { $subtract: [new Date(), { $max: '$orders.created_at' }] },
                  1000 * 60 * 60 * 24
                ]
              }
            },
            999999
          ]
        },
        tenure_days: {
          $floor: {
            $divide: [
              { $subtract: [new Date(), '$created_at'] },
              1000 * 60 * 60 * 24
            ]
          }
        }
      }
    },
    { $match: matchQuery }
  ];

  const results = await customersColl.aggregate(pipeline).toArray();
  return results.map(r => ({ ...r, id: r._id.toString() }));
}

export function describeRules(rules) {
  const LABEL = {
    total_spend: 'lifetime spend', order_count: 'orders', avg_order_value: 'avg order value',
    last_order_days: 'days since last order', tenure_days: 'days since joining', city: 'city',
  };
  const { logic, conditions } = validateRules(rules);
  return conditions
    .map((c) => `${LABEL[c.field]} ${c.op === 'contains' ? 'contains' : c.op} ${typeof c.value === 'number' && (c.field === 'total_spend' || c.field === 'avg_order_value') ? '₹' + c.value.toLocaleString('en-IN') : c.value}`)
    .join(logic === 'AND' ? ' and ' : ' or ');
}
