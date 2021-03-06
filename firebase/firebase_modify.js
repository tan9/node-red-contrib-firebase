module.exports = function(RED) {
  'use strict';
  var Firebase = require('firebase');
  var utils = require("./FirebaseUtils.js");
  String.prototype.capitalize = function() {
      return this.charAt(0).toUpperCase() + this.slice(1);
  }

  function FirebaseModify(n) {
      RED.nodes.createNode(this,n);

      this.config = RED.nodes.getNode(n.firebaseconfig);
      this.childpath = n.childpath;
      this.childtype = n.childtype;
      this.childvalue = n.childvalue;
      this.value = n.value;
      this.valuetype = n.valuetype;
      this.valueval = n.valueval;
      this.priority = n.priority;
      this.prioritytype = n.prioritytype;
      this.priorityval = n.priorityval;
      this.fbRequests = [];
      //this.method = n.method;
      this.method = n.methodtype;
      this.methodval -= n.methodval;

      this.ready = false;

      this.validMethods = {
        "set": true,
        "update": true,
        "push": true,
        "remove": true,
    		"setPriority": true,
    		"setWithPriority": true
      }

      // Check credentials
      if (!this.config) {
          this.status({fill:"red", shape:"ring", text:"invalid credentials"})
          this.error('You need to setup Firebase credentials!');
          return
      }

      this.fbOnComplete = function(error) {
          //this.log("fb oncomplete.  error = " + error)
          var msg = this.fbRequests.shift() //Firebase will call these in order for us
          //TODO: Once Node-Red supports it, we should flash the Node when we receive this data.
          if(error){
            this.log("firebase synchronization failed")
            this.error("firebase synchronization failed - " + error, msg)
          } else {
          	this.send(msg)
          }
      }.bind(this);


      //this.config.fbConnection EventEmitter Handlers
      this.fbInitializing = function(){  //This isn't being called because its emitted too early...
        this.status({fill:"grey", shape:"ring", text:"initializing..."})
        this.ready = false;
      }.bind(this)

      this.fbConnected = function(){
        this.status({fill:"green", shape:"ring", text:"connected"})
        this.ready = false;
      }.bind(this)

      this.fbDisconnected = function(){
        this.status({fill:"red", shape:"ring", text:"disconnected"})
        this.ready = false;
      }.bind(this)

      this.fbAuthorized = function(authData){
        this.status({fill:"green", shape:"dot", text:"ready"})
        this.ready = true;
      }.bind(this)

      this.fbUnauthorized = function(){
        this.status({fill:"red", shape:"dot", text:"unauthorized"})
        this.ready = false;
      }.bind(this)

      this.fbError = function(error){
        this.status({fill:"red", shape:"ring", text:error})
      }.bind(this)

      this.fbClosed = function(error){
        this.status({fill: "gray", shape: "dot", text:"connection closed"})
        this.ready = false;
      }.bind(this)


      //Register Handlers
      this.config.fbConnection.on("initializing", this.fbInitializing)
      this.config.fbConnection.on("connected", this.fbConnected)
      this.config.fbConnection.on("disconnected", this.fbDisconnected)
      this.config.fbConnection.on("authorized", this.fbAuthorized)
      this.config.fbConnection.on("unauthorized", this.fbUnauthorized)
      this.config.fbConnection.on("error", this.fbError)
      this.config.fbConnection.on("closed", this.fbClosed)

      //set initial state (depending on the deployment strategy, for newly deployed nodes, some of the events may not be refired...)
      switch(this.config.fbConnection.lastEvent) {
        case "initializing":
        case "connected":
        case "disconnected":
        case "authorized":
        case "unauthorized":
        case "error":
        case "closed":
          this["fb" + this.config.fbConnection.lastEvent.capitalize()](this.config.fbConnection.lastEventData)  //Javascript is really friendly about sending arguments to functions...
          break;
        // case "undefined":
        // case "null":
        //   break;  //Config node not yet setup
        default:
          this.error("Bad lastEvent Data from Config Node - " + this.config.fbConnection.lastEvent)
      }


      this.on('input', function(msg) {
        if(this.ready){
          var method = this.method
          var value;
          if (method != "setPriority"){

            value = utils.getType(this.valuetype,this.valueval,msg,this);

            if(value == "jsonata"){
              try{
                var valueval = this.valueval;
                value = RED.util.prepareJSONataExpression(valueval,this);
                value = RED.util.evaluateJSONataExpression(value,msg);
              } catch(e){
                node.error(RED._("firebase.modify.errors.invalid-expr",{error:err.message}));
                }           
            }
            else if(value == "serverTS"){
              value = Firebase.database.ServerValue.TIMESTAMP;
            }
            msg.payload = value;
          }
 
          //Parse out msg.priority
          var priority = null;
          var val;
          if (method == "setPriority" || method == "setWithPriority"){
            priority = this.priority;
            if (priority == null){
              this.error("Expected \"priority\" property not included", msg)
              return;
            }  

            val = utils.getType(this.prioritytype,this.priorityval,msg,this);

            if(val == "jsonata"){
              try{
                  var valueval = this.valueval;
                  val = RED.util.prepareJSONataExpression(this.priorityval,this);
                  val = RED.util.evaluateJSONataExpression(val,msg);
              } catch(e){
                  node.error(RED._("firebase.modify.errors.invalid-expr",{error:err.message}));
              }  
            }
           else if(val== "serverTS"){
              val = Firebase.database.ServerValue.TIMESTAMP;
           }
              msg.priority = val;
         } 
         
          var childpath = utils.getType(this.childtype,this.childvalue,msg,this);
          //Parse out msg.childpath         
          if(childpath == "jsonata"){
            try{
                var childvalue = this.childvalue;
                childpath = RED.util.prepareJSONataExpression(childvalue,this);
                childpath = RED.util.evaluateJSONataExpression(childpath, msg);
            }catch(e){
                node.error(RED._("firebase.modify.errors.invalid-expr",{error:err.message}));
            }           
          }
         
          childpath = childpath || "/"
         
          msg.childpath = childpath || "/";


          switch (method){
            case "set":
            case "update":
              this.fbRequests.push(msg)
              this.config.fbConnection.fbRef.child(childpath)[method](msg.payload, this.fbOnComplete.bind(this)); //TODO: Why doesn't the Firebase API support passing a context to these calls?
              break;
            case "push":
              var pushRef = this.config.fbConnection.fbRef.child(childpath)[method]();
              msg.pushID = pushRef.key;
              this.fbRequests.push(msg)
              pushRef.set(msg.payload, this.fbOnComplete.bind(this)); //TODO: Why doesn't the Firebase API support passing a context to these calls?
              break;
            case "remove":
              this.fbRequests.push(msg)
              this.config.fbConnection.fbRef.child(childpath)[method](this.fbOnComplete.bind(this));
              break;
            case "setPriority":
              this.fbRequests.push(msg)
              this.config.fbConnection.fbRef.child(childpath)[method](priority, this.fbOnComplete.bind(this));
              break;
            case "setWithPriority":
              this.fbRequests.push(msg)
              this.config.fbConnection.fbRef.child(childpath)[method](msg.payload, priority, this.fbOnComplete.bind(this));
              break;
            default:
              this.error("Invalid msg.method property \"" + method + "\".  Expected one of the following: [\"" + Object.keys(this.validMethods).join("\", \"") + "\"].", msg)
              break;
          }
        } else {
          this.warn("Received msg before firebase modify node was ready.  Not processing: " + JSON.stringify(msg, null, "\t"))
        }
      });


      this.on('close', function() {
        //Cancel modify request to firebase??
      });

  }
  RED.nodes.registerType("firebase modify", FirebaseModify);
};
