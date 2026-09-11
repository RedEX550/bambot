/**
 * The poll button handler lives with the command that builds the message, but
 * the component registry only scans this directory, so it is re-exported here.
 */
import { pollHandler } from "../commands/poll";

export default pollHandler;
