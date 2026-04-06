#include <node_api.h>
#include <sys/socket.h>
#include <string.h>

/*
 * getPeerCred(fd: number): { uid: number, gid: number, pid: number }
 *
 * Calls getsockopt(fd, SOL_SOCKET, SO_PEERCRED) to retrieve the
 * kernel-verified credentials of the process on the other end
 * of a Unix domain socket.
 *
 * Linux only. This is the same mechanism used by systemd, D-Bus,
 * and other privilege-aware daemons.
 */

static napi_value get_peer_cred(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

  if (argc < 1) {
    napi_throw_error(env, NULL, "getPeerCred requires a file descriptor argument");
    return NULL;
  }

  int fd;
  napi_get_value_int32(env, argv[0], &fd);

  struct ucred cred;
  socklen_t len = sizeof(cred);
  memset(&cred, 0, sizeof(cred));

  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) == -1) {
    napi_throw_error(env, NULL, "getsockopt(SO_PEERCRED) failed");
    return NULL;
  }

  napi_value result, uid_val, gid_val, pid_val;
  napi_create_object(env, &result);
  napi_create_uint32(env, (uint32_t)cred.uid, &uid_val);
  napi_create_uint32(env, (uint32_t)cred.gid, &gid_val);
  napi_create_int32(env, cred.pid, &pid_val);
  napi_set_named_property(env, result, "uid", uid_val);
  napi_set_named_property(env, result, "gid", gid_val);
  napi_set_named_property(env, result, "pid", pid_val);

  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "getPeerCred", NAPI_AUTO_LENGTH, get_peer_cred, NULL, &fn);
  napi_set_named_property(env, exports, "getPeerCred", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
