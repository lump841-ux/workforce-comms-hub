'use strict';
const express=require('express');
const { db,get }=require('../database/db');
const { config,sdk }=require('../services/stripeTest');
const router=express.Router();
router.post('/',express.raw({type:'application/json',limit:'256kb'}),(req,res)=>{
 const c=config();
 if(!c.enabled)return res.status(503).send('Test webhooks disabled');
 let event;
 try{event=sdk().webhooks.constructEvent(req.body,req.headers['stripe-signature'],c.webhookSecret)}
 catch(e){return res.status(400).send('Invalid webhook signature')}
 if(event.livemode)return res.status(400).send('Live events are not accepted');
 const o=event.data.object||{};
 let agencyId=null,subscriptionId=null,customerId=null,plan=null,state=null,period=null;
 if(event.type==='checkout.session.completed'&&o.mode==='subscription'){
  agencyId=o.client_reference_id;subscriptionId=o.subscription;customerId=o.customer;plan=o.metadata?.plan_code;state='trialing';
 }else if(event.type==='customer.subscription.created'||event.type==='customer.subscription.updated'||event.type==='customer.subscription.deleted'){
  agencyId=o.metadata?.agency_id;subscriptionId=o.id;customerId=o.customer;plan=o.metadata?.plan_code;state=o.status;period=o.current_period_end?new Date(o.current_period_end*1000).toISOString():null;
 }else{return res.json({received:true,ignored:true})}
 if(!agencyId||typeof agencyId!=='string'||!subscriptionId||typeof subscriptionId!=='string')return res.status(422).send('Missing billing mapping');
 if(!get('SELECT id FROM agencies WHERE id = ?',[agencyId]))return res.status(422).send('Unknown agency');
 const allowed=['trialing','active','past_due','canceled','unpaid','paused'];
 if(!allowed.includes(state))state='not_configured';
 // The transaction binds the webhook event to its agency and prevents repeat processing.
 try{
  db.exec('BEGIN IMMEDIATE');
  const existing=get('SELECT event_id FROM billing_webhook_events WHERE event_id = ?',[event.id]);
  if(existing){db.exec('COMMIT');return res.json({received:true,duplicate:true})}
  db.prepare('INSERT INTO billing_webhook_events(event_id,event_type) VALUES (?,?)').run(event.id,event.type);
  // Never reassign a subscription belonging to a different agency.
  const other=get('SELECT agency_id FROM agency_billing WHERE stripe_subscription_id = ? AND agency_id <> ?',[subscriptionId,agencyId]);
  if(other)throw Error('Conflicting agency mapping');
  db.prepare(`INSERT INTO agency_billing(agency_id,stripe_customer_id,stripe_subscription_id,plan_code,subscription_status,current_period_end)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(agency_id) DO UPDATE SET
      stripe_customer_id=COALESCE(excluded.stripe_customer_id,stripe_customer_id),
      stripe_subscription_id=excluded.stripe_subscription_id,
      plan_code=COALESCE(excluded.plan_code,plan_code),
      subscription_status=CASE WHEN excluded.subscription_status='trialing' AND agency_billing.subscription_status='active' THEN agency_billing.subscription_status ELSE excluded.subscription_status END,
      current_period_end=COALESCE(excluded.current_period_end,current_period_end),
      updated_at=datetime('now')`).run(agencyId,customerId,subscriptionId,plan||null,state,period);
  db.exec('COMMIT');
  return res.json({received:true});
 }catch(e){try{db.exec('ROLLBACK')}catch(_){}return res.status(500).send('Webhook processing failed')}
});
module.exports=router;
